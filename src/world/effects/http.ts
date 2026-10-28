// What the copy imports in place of `node:http` and `node:https`.
//
// A request a run makes reaches no machine. Unless a failure is injected it gets status 200 and an
// empty body. When one is, it fails the way a real request fails: a connection that cannot be made,
// a connection reset part way through, a short response, a body that does not parse or a server
// error.
//
// A server the code under test creates listens on a port of the run's network, which no machine
// reaches. A request the same run makes to that port on this machine is carried to it in memory, so
// a program that serves and asks itself, and a scenario standing in for a service, work as they
// would on a real port.

import { EventEmitter } from "node:events";
import realHttp from "node:http";
import { Readable, type Duplex } from "node:stream";
import { nowRunning } from "../current.ts";
import { abortError, codeOf, networkError } from "../effects.ts";
import { connectError, httpAnswer, isAborted, listenFailures, loopbackPair, portOf, requestFailures, type HttpAnswer, type ILoopbackServer, type ILoopbackSocket, type RunNetwork } from "../network.ts";

// Everything the real module has and this one does not replace: its constants, its status codes
// and its agents. Every call that reaches the network is declared below, and a name declared here
// wins over the one the star brings in.
export * from "node:http";

// One answer from the simulated network, as the readable stream `node:http` hands a caller. It is
// not exported as `IncomingMessage`: a server's request is Node's own, and a web framework builds
// its request on `IncomingMessage`, so that name stays Node's.
class RunResponse extends Readable {
    // The status the server answered with.
    readonly statusCode: number;

    // What the status means, as Node words it.
    readonly statusMessage: string;

    // What the server sent back with it, by lower case name.
    readonly headers: Record<string, string>;

    // The version of HTTP the answer came in.
    readonly httpVersion = "1.1";

    // The body still to hand over.
    private left: Buffer;

    // The error reading the body fails with, for a connection reset part way through.
    private readonly resetWith: Error | undefined;

    constructor(answer: HttpAnswer, host: string) {
        super();
        this.statusCode = answer.status;
        // Every answer the simulated network gives has a status Node words.
        this.statusMessage = realHttp.STATUS_CODES[answer.status]!;
        this.headers = { ...answer.headers };
        this.left = answer.body;
        this.resetWith = answer.resetsAfterHeaders ? connectError("connection-reset-part-way-through", host) : undefined;
    }

    override _read(): void {
        if (this.resetWith !== undefined) {
            this.destroy(this.resetWith);
            return;
        }
        if (this.left.length === 0) {
            this.push(null);
            return;
        }
        const piece = this.left;
        this.left = Buffer.alloc(0);
        this.push(piece);
    }

    setTimeout(): this {
        return this;
    }
}

// One request, as `node:http` hands it back. What is written to it goes nowhere, and the answer
// arrives once the caller has ended it.
class ClientRequest extends EventEmitter {
    // Where the request was aimed, for the error a failure carries.
    private readonly host: string;

    // The signal the caller can abort the request with.
    private readonly signal: AbortSignal | undefined;

    // Whether the request has been sent, so ending twice sends once.
    private sent = false;

    // Whether the caller gave up on the request.
    destroyed = false;

    // The failure already chosen for the request, for one aimed at a server of the run, whose place
    // was asked about before it was known whether the request goes to that server. Undefined when
    // the injector is to be asked when the request is sent.
    private readonly decided: string | undefined;

    constructor(host: string, signal: AbortSignal | undefined, callback: ((answer: RunResponse) => void) | undefined, decided: string | undefined) {
        super();
        this.host = host;
        this.signal = signal;
        this.decided = decided;
        if (callback !== undefined) {
            this.on("response", callback);
        }
    }

    // Takes part of the body, which goes nowhere.
    write(_chunk?: unknown, _encoding?: unknown, done?: unknown): boolean {
        const callback = typeof _encoding === "function" ? _encoding : done;
        if (typeof callback === "function") {
            queueMicrotask(() => (callback as () => void)());
        }
        return true;
    }

    // Sends the request and brings back the answer, or the failure the injector chose.
    end(_chunk?: unknown, _encoding?: unknown, done?: unknown): this {
        if (this.sent) {
            return this;
        }
        this.sent = true;
        const callback = [_chunk, _encoding, done].find((one) => typeof one === "function") as (() => void) | undefined;
        const running = nowRunning();
        if (running === undefined) {
            return this;
        }
        if (isAborted(running.injector, this.signal)) {
            queueMicrotask(() => this.emit("error", abortError()));
            return this;
        }
        const failure = this.decided ?? running.network.check(requestFailures);
        const answer = httpAnswer(failure);
        queueMicrotask(() => {
            if (callback !== undefined) {
                callback();
            }
            if (this.destroyed) {
                return;
            }
            if (answer === undefined) {
                this.emit("error", connectError(failure!, this.host));
                return;
            }
            this.emit("response", new RunResponse(answer, this.host));
        });
        return this;
    }

    // Gives up on the request.
    destroy(error?: Error): this {
        this.destroyed = true;
        if (error !== undefined) {
            queueMicrotask(() => this.emit("error", error));
        }
        return this;
    }

    // The same, by its older name.
    abort(): void {
        this.destroy();
    }

    setHeader(): this {
        return this;
    }

    getHeader(): undefined {
        return undefined;
    }

    removeHeader(): void {
        // The request is sent nowhere, so there is no header to take off it.
    }

    flushHeaders(): void {
        // The request is sent nowhere, so there is nothing to flush.
    }

    // Says how long the request may take. Simulated time moves only for timers, so the deadline is
    // never reached.
    setTimeout(): this {
        return this;
    }

    setNoDelay(): void {
        // No bytes are sent, so holding small ones back changes nothing.
    }

    setSocketKeepAlive(): void {
        // No socket is opened, so there is none to keep alive.
    }
}

// Where a request was aimed, read from whichever of the ways a caller says it.
function hostOf(target: unknown): string {
    if (typeof target === "string") {
        try {
            return new URL(target).host;
        }
        catch {
            return target;
        }
    }
    if (target instanceof URL) {
        return target.host;
    }
    const held = target as { host?: string; hostname?: string } | undefined;
    return held?.hostname ?? held?.host ?? "localhost";
}

// The signal a request was given in its options.
function signalOf(target: unknown, options: unknown): AbortSignal | undefined {
    for (const given of [options, target]) {
        if (given !== null && typeof given === "object" && !(given instanceof URL)) {
            const signal = (given as { signal?: AbortSignal }).signal;
            if (signal !== undefined) {
                return signal;
            }
        }
    }
    return undefined;
}

// Where a request is aimed: the host by name and the port, read from whichever of the ways a
// caller says it. A request that names no port goes to the default of its scheme.
export function aimOf(target: unknown, options: unknown): { hostname: string; port: number } {
    if (typeof target === "string" || target instanceof URL) {
        try {
            const url = new URL(target);
            return { hostname: url.hostname, port: portOf(url) };
        }
        catch {
            return { hostname: String(target), port: 80 };
        }
    }
    const held = { ...(target as object | undefined), ...(typeof options === "object" && options !== null ? options : {}) } as { host?: string; hostname?: string; port?: number | string; defaultPort?: number; protocol?: string };
    const port = held.port ?? held.defaultPort ?? (held.protocol === "http:" ? 80 : 443);
    return { hostname: held.hostname ?? held.host?.split(":")[0] ?? "localhost", port: Number(port) };
}

// Sends a request to a server of the run over an in-memory connection, with Node's own HTTP code
// on both ends, so the server reads it and answers it as it would on a real port. A request asked
// for over HTTPS is carried as HTTP, because the bytes never leave the process. The request counts
// as under way on `network` until it closes, so the call's timers wait for it.
export function requestFrom(network: RunNetwork, server: ILoopbackServer, target: unknown, options: unknown, done: ((answer: unknown) => void) | undefined): realHttp.ClientRequest {
    const aimed = aimOf(target, options);
    const [client, accepted] = loopbackPair(aimed.port, () => network.noteActivity());
    let fromTarget: object = {};
    if (typeof target === "string" || target instanceof URL) {
        const url = new URL(target);
        fromTarget = { hostname: url.hostname, port: aimed.port, path: `${url.pathname}${url.search}` };
    }
    else {
        fromTarget = Object.assign({}, target);
    }
    const given = typeof options === "object" && options !== null ? options : {};
    const sent = realHttp.request({
        ...fromTarget,
        ...given,
        protocol: "http:",
        port: aimed.port,
        agent: undefined,
        createConnection: (connecting: realHttp.RequestOptions) => connectLoopback(client, connecting),
    }, done);
    network.startExchange();
    sent.once("close", () => {
        network.endExchange();
    });
    server.accept(accepted);
    return sent;
}

// Hands Node's HTTP code the client's end of an in-memory connection, with the request's `timeout`
// set on it, as `net.createConnection` sets it on the socket it makes for a real request.
export function connectLoopback(client: ILoopbackSocket, connecting: realHttp.RequestOptions): ILoopbackSocket {
    if (typeof connecting.timeout === "number") {
        client.setTimeout(connecting.timeout, undefined);
    }
    return client;
}

export function request(target: unknown, options?: unknown, callback?: unknown): ClientRequest {
    const running = nowRunning();
    if (running === undefined) {
        return (realHttp.request as (...args: unknown[]) => unknown)(target, options, callback) as unknown as ClientRequest;
    }
    const done = (typeof options === "function" ? options : callback) as ((answer: RunResponse) => void) | undefined;
    const aimed = aimOf(target, options);
    const server = running.network.serverAt(aimed.hostname, aimed.port);
    if (server) {
        //
        // A request to a server of the run is a place like any other: it fails the way a request
        // fails when a failure is injected there, and reaches the server when none is.
        //
        const failure = running.network.check(requestFailures);
        if (failure !== undefined) {
            return new ClientRequest(hostOf(target), signalOf(target, options), done, failure);
        }
        return requestFrom(running.network, server, target, typeof options === "function" ? undefined : options, done as ((answer: unknown) => void) | undefined) as unknown as ClientRequest;
    }
    return new ClientRequest(hostOf(target), signalOf(target, options), done, undefined);
}

export function get(target: unknown, options?: unknown, callback?: unknown): ClientRequest {
    if (nowRunning() === undefined) {
        return (realHttp.get as (...args: unknown[]) => unknown)(target, options, callback) as unknown as ClientRequest;
    }
    return request(target, options, callback).end();
}

// A server the code under test creates. It listens on a port of the run's network, which no
// machine outside the run can reach, and a request the run makes to that port on this machine is
// carried to it in memory and answered by Node's own HTTP code, which hands the handler Node's own
// request and response.
class Server extends EventEmitter implements ILoopbackServer {
    // Whether the server is listening, which it says it is once `listen` succeeds.
    listening = false;

    // The port it listens on once it is listening, or 0 before.
    private port = 0;

    // The run's network it listens on, kept so closing it stops it listening there.
    private network: RunNetwork | undefined;

    // Node's own server, made when the first connection arrives, which reads each request off the
    // connection and writes each answer onto it.
    private real: realHttp.Server | undefined;

    // Takes one connection made from inside the run and hands each request on it to the handler.
    accept(socket: Duplex): void {
        if (!this.real) {
            this.real = realHttp.createServer((request, response) => {
                this.emit("request", request, response);
            });
        }
        this.real.emit("connection", socket);
    }

    constructor(handler?: (request: unknown, response: unknown) => void) {
        super();
        if (handler !== undefined) {
            // Node registers what `createServer` was given as a listener for a request, and so does
            // this, so a server answers one way whichever way it was given its handler.
            this.on("request", handler);
        }
    }

    // Takes the address the caller asked for and tells it the server is up, or fails the way
    // listening fails when the injector says so.
    listen(...args: unknown[]): this {
        const done = args.find((one) => typeof one === "function") as (() => void) | undefined;
        const asked = args.find((one) => typeof one === "number" || (typeof one === "string" && /^[0-9]+$/.test(one)));
        const port = asked === undefined ? 0 : Number(asked);
        const running = nowRunning();
        const failure = running?.network.check(listenFailures);
        queueMicrotask(() => {
            if (failure !== undefined) {
                this.emit("error", networkError(codeOf(failure), "listen", `:::${String(port)}`));
                return;
            }
            if (running) {
                this.network = running.network;
                this.port = running.network.listenAt(port, this);
            }
            this.listening = true;
            if (done !== undefined) {
                done();
            }
            this.emit("listening");
        });
        return this;
    }

    // Shuts the server down: it stops listening on the run's network and the connections it took
    // are ended.
    // A server that is not listening closes as Node's does: it says it closed, and the callback is
    // given an `ERR_SERVER_NOT_RUNNING` error.
    close(done?: (error?: Error) => void): this {
        const wasListening = this.listening;
        if (wasListening) {
            this.network?.stopListening(this.port);
        }
        this.listening = false;
        this.real?.closeAllConnections();
        queueMicrotask(() => {
            if (done !== undefined) {
                done(wasListening ? undefined : Object.assign(new Error("Server is not running."), {
                    code: "ERR_SERVER_NOT_RUNNING",
                }));
            }
            this.emit("close");
        });
        return this;
    }

    // The address the server is on: the loopback address and the port of the run's network it
    // listens on.
    address(): { address: string; family: string; port: number } {
        return {
            address: "127.0.0.1",
            family: "IPv4",
            port: this.port,
        };
    }

    setTimeout(): this {
        return this;
    }

    closeAllConnections(): void {
        this.real?.closeAllConnections();
    }

    closeIdleConnections(): void {
        this.real?.closeIdleConnections();
    }
}

export function createServer(options?: unknown, handler?: unknown): Server {
    const found = (typeof options === "function" ? options : handler) as ((request: unknown, response: unknown) => void) | undefined;
    return new Server(found);
}

export { ClientRequest, RunResponse, Server };

//
// What `import http from "node:http"` gets, written out by name. Left to be inferred, its type
// takes the real module's types from `undici-types`, and in a project whose packages Bun keeps in
// `node_modules/.bun/` the declaration file can only name them by a path into that directory, so
// the build Faultline runs when it is installed failed with TS2742.
//
export interface ISimulatedHttp extends Omit<typeof realHttp, "request" | "get" | "createServer" | "ClientRequest" | "Server"> {
    //
    // A request made on the run's network.
    //
    request: typeof request;

    //
    // A request with no body, made on the run's network.
    //
    get: typeof get;

    //
    // A server that listens on the run's network.
    //
    createServer: typeof createServer;

    //
    // The request a call on the run's network gives back.
    //
    ClientRequest: typeof ClientRequest;

    //
    // The server a call of `createServer` gives back.
    //
    Server: typeof Server;
}

// What `import http from "node:http"` gets: the real module's constants, agents and the request
// and response a server is handed, with every call that reaches the network replaced.
const simulatedHttp: ISimulatedHttp = {
    ...realHttp,
    request,
    get,
    createServer,
    ClientRequest,
    Server,
};

export default simulatedHttp;
