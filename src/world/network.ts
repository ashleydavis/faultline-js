// The simulated network: what a request, a connection or a name lookup a run makes is answered
// with.
//
// No call reaches a machine. Unless a failure is injected, a connection is accepted and the other
// end sends no data, a name resolves to the loopback address and an HTTP request gets status 200
// and an empty body. When a failure is injected the call fails the way Node fails. The one
// exception is a request to a port a server of the same run listens on, on this machine, which
// reaches that server.
//
// `fetch` is answered here. The replaced `node:http`, `node:https`, `node:net` and `node:dns` read
// the failure lists and the answers from here, so a failure means the same in each.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import realHttp from "node:http";
import { duplexPair, type Duplex } from "node:stream";
import { codeOf, networkError } from "./effects.ts";
import type { Injector } from "./injector.ts";

// What opening a connection can fail with.
export const connectFailures = [
    "name-does-not-resolve",
    "connection-refused",
    "connection-times-out",
    "network-unreachable",
    "connection-reset-part-way-through",
    "host-unreachable",
    "connection-aborted",
];

// What an HTTP request can fail with: what opening its connection can, and three ways the answer
// can go wrong.
export const requestFailures = [...connectFailures, "short-response", "response-that-does-not-parse", "server-error"];

// What looking up a name can fail with.
export const lookupFailures = ["name-does-not-resolve", "name-server-fails", "host-lookup-finds-no-address"];

// What listening on an address can fail with.
export const listenFailures = ["address-already-in-use-when-listening", "address-not-available"];

// The address every name resolves to when the lookup works. Nothing is dialled, so it is the
// loopback address, which a caller that prints it recognises.
export const resolvedAddress = "127.0.0.1";

// What an HTTP request is answered with.
export interface HttpAnswer {
    // The status the server answered with.
    status: number;

    // The headers it sent, by lower case name.
    headers: Record<string, string>;

    // The body it sent.
    body: Buffer;

    // Whether the connection is reset once the headers are read, so reading the body fails.
    resetsAfterHeaders: boolean;
}

// The body of a response that ends early, and the length its `content-length` header says. The
// body is the first part of a JSON document, so a caller that trusts the length and parses fails.
const shortBody = '{"items":[';

// The length a short response claims: twice what it sends.
const shortBodyClaimedLength = shortBody.length * 2;

// The body of a response that does not parse, sent as JSON. It is a page where a document was
// asked for, which is what a proxy that answers in place of the server sends.
const unparsableBody = "<html>not what was asked for</html>";

// The system call Node names for a failure to connect: a lookup for a name that does not resolve,
// a read for a connection reset part way through, and a connect for the rest.
export function syscallOf(failure: string): string {
    if (failure === "name-does-not-resolve") {
        return "getaddrinfo";
    }
    if (failure === "connection-reset-part-way-through") {
        return "read";
    }
    return "connect";
}

// The error opening a connection to `host` fails with, for a failure that stops it opening.
export function connectError(failure: string, host: string): Error {
    return networkError(codeOf(failure), syscallOf(failure), host);
}

// What an HTTP request is answered with when the injector chose `failure`, or none when the
// failure stops the request before any answer.
export function httpAnswer(failure: string | undefined): HttpAnswer | undefined {
    if (failure === undefined) {
        return {
            status: 200,
            headers: {
                "content-length": "0",
            },
            body: Buffer.alloc(0),
            resetsAfterHeaders: false,
        };
    }
    if (failure === "short-response") {
        return {
            status: 200,
            headers: {
                "content-type": "application/json",
                "content-length": String(shortBodyClaimedLength),
            },
            body: Buffer.from(shortBody),
            resetsAfterHeaders: false,
        };
    }
    if (failure === "response-that-does-not-parse") {
        return {
            status: 200,
            headers: {
                "content-type": "application/json",
                "content-length": String(unparsableBody.length),
            },
            body: Buffer.from(unparsableBody),
            resetsAfterHeaders: false,
        };
    }
    if (failure === "server-error") {
        return {
            status: 500,
            headers: {
                "content-length": "0",
            },
            body: Buffer.alloc(0),
            resetsAfterHeaders: false,
        };
    }
    if (failure === "connection-reset-part-way-through") {
        return {
            status: 200,
            headers: {
                "content-type": "application/json",
            },
            body: Buffer.alloc(0),
            resetsAfterHeaders: true,
        };
    }
    return undefined;
}

// Where a request is aimed, as the host Node names in its errors.
export function hostOf(address: string): string {
    try {
        return new URL(address).host;
    }
    catch {
        return address;
    }
}

// Asks whether a call given an `AbortSignal` is aborted. A signal already aborted aborts the call
// as Node aborts it, and so does the failure the injector can choose for any call given a signal.
export function isAborted(injector: Injector, signal: AbortSignal | undefined): boolean {
    if (signal === undefined || signal === null) {
        return false;
    }
    const failure = injector.check("cancellation", ["operation-aborted"]);
    return failure !== undefined || signal.aborted;
}

// A server the code under test listens with, as the network hands it a connection made to its
// port from inside the run.
export interface ILoopbackServer {
    // Takes one connection: the server's end of a pair of streams the client writes to.
    accept(socket: Duplex): void;
}

// The first port a server that asks for any port is given, the start of the range Node's own
// systems hand out for that, so a port the code under test prints looks like one it would get.
export const firstGivenPort = 49152;

// The names of the machine the run is on: a request aimed at one of them, at a port a server of
// the run listens on, reaches that server.
const loopbackNames = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

// Whether a host names the machine the run is on.
export function isLoopback(host: string): boolean {
    return loopbackNames.has(host.toLowerCase());
}

// The idle timeout of one end of an in-memory connection, as `socket.setTimeout` sets it on a real
// socket: once the connection has carried nothing for the time it was given, the end emits
// `timeout`. The timer is set with the replaced `setTimeout`, so in a run it waits on the run's
// clock, and a request whose server never answers reaches its timeout when the run's timers run.
export class IdleTimeout {
    // The end that emits `timeout`.
    private readonly end: Duplex;

    // How long the connection may carry nothing, in milliseconds. Zero turns the timeout off, as it
    // does on a real socket.
    private idleMs = 0;

    // The timer waiting for the connection to have been idle for `idleMs`, or undefined when none is.
    private timer: NodeJS.Timeout | undefined = undefined;

    constructor(end: Duplex) {
        this.end = end;
        end.once("close", () => {
            this.stop();
        });
    }

    // Sets how long the connection may carry nothing, and adds `callback` as a listener for the
    // timeout when it is a function, as `socket.setTimeout` does.
    set(idleMs: number, callback: (() => void) | undefined): void {
        assert(Number.isFinite(idleMs), `A socket timeout of ${idleMs}ms is not a number of milliseconds.`);
        assert(idleMs >= 0, `A socket timeout of ${idleMs}ms is less than zero.`);
        this.idleMs = idleMs;
        if (typeof callback === "function") {
            this.end.once("timeout", callback);
        }
        this.restart();
    }

    // Starts the wait again, because the connection carried something. An end that has closed
    // waits for nothing.
    restart(): void {
        this.stop();
        if (this.end.destroyed) {
            return;
        }
        if (this.idleMs > 0) {
            this.timer = setTimeout(() => {
                this.timer = undefined;
                //
                // An end destroyed before its close event came is closed already.
                //
                if (!this.end.destroyed) {
                    this.end.emit("timeout");
                }
            }, this.idleMs);
        }
    }

    // Stops the wait, for an end that has closed or been given a new timeout.
    stop(): void {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        assert.equal(this.timer, undefined);
    }
}

// The two ends of an in-memory connection, each with the calls Node's HTTP code makes on a socket
// and the addresses it reads. Every write and every end on either side calls `onActivity`, so the
// run can tell an exchange that is moving from one that has gone quiet, and starts the idle
// timeout of both ends again, because what one end writes the other reads.
export function loopbackPair(port: number, onActivity: () => void): [ILoopbackSocket, ILoopbackSocket] {
    const [client, server] = duplexPair();
    const timeouts = [new IdleTimeout(client), new IdleTimeout(server)];
    const restartBoth = (): void => {
        onActivity();
        for (const timeout of timeouts) {
            timeout.restart();
        }
    };
    const sockets: ILoopbackSocket[] = [];
    for (const [index, end] of [client, server].entries()) {
        const write = end.write.bind(end);
        const finish = end.end.bind(end);
        const timeout = timeouts[index]!;
        sockets.push(Object.assign(end, {
            write: (...args: Parameters<Duplex["write"]>): boolean => {
                restartBoth();
                return write(...args);
            },
            end: (...args: Parameters<Duplex["end"]>): Duplex => {
                restartBoth();
                return finish(...args);
            },
            setTimeout: (idleMs: number, callback: (() => void) | undefined): Duplex => {
                timeout.set(idleMs, callback);
                return end;
            },
            setNoDelay: () => end,
            setKeepAlive: () => end,
            ref: () => end,
            unref: () => end,
            remoteAddress: "127.0.0.1",
            remoteFamily: "IPv4",
            localAddress: "127.0.0.1",
            remotePort: port,
            localPort: port,
        }));
    }
    assert.equal(sockets.length, 2);
    return [sockets[0]!, sockets[1]!];
}

// One end of an in-memory connection, with the idle timeout a socket has.
export interface ILoopbackSocket extends Duplex {
    // Sets how long the connection may carry nothing before this end emits `timeout`, as
    // `socket.setTimeout` does.
    setTimeout(idleMs: number, callback: (() => void) | undefined): Duplex;
}

// The port a URL is aimed at: the one it names, or the default of its scheme.
export function portOf(url: URL): number {
    if (url.port !== "") {
        return Number(url.port);
    }
    return url.protocol === "https:" ? 443 : 80;
}

// Answers a `fetch` from a server of the run, carried over an in-memory connection by Node's own
// HTTP code, so the server reads the request and writes its answer as it would on a real port.
//
// The body is handed over as it arrives, as Node's own `fetch` hands it over, so a server that
// fails part way through the body fails the reading of it rather than the `fetch`. `onDone` is
// called once, when the exchange is over: when the body has been read or has failed, or when the
// request failed before any answer.
//
export async function fetchFrom(server: ILoopbackServer, url: URL, asked: Request, onActivity: () => void, onDone: () => void): Promise<Response> {
    //
    // A listener added once, so the exchange ends once however many of the ways it can end come.
    //
    const ending = new EventEmitter();
    ending.once("end", onDone);
    const finish = (): void => {
        ending.emit("end");
    };
    const [client, accepted] = loopbackPair(portOf(url), onActivity);
    const body = asked.body ? Buffer.from(await asked.arrayBuffer()) : undefined;
    const headers: Record<string, string> = {};
    asked.headers.forEach((value, name) => {
        headers[name] = value;
    });
    if (body) {
        headers["content-length"] = String(body.length);
    }
    const answer = await new Promise<realHttp.IncomingMessage>((resolve, reject) => {
        const sent = realHttp.request({
            protocol: "http:",
            hostname: url.hostname,
            port: portOf(url),
            path: `${url.pathname}${url.search}`,
            method: asked.method,
            headers,
            agent: undefined,
            createConnection: () => client,
        }, resolve);
        sent.on("error", (error: Error) => {
            finish();
            reject(error);
        });
        server.accept(accepted);
        sent.end(body);
    });
    answer.once("close", finish);
    const answerHeaders = new Headers();
    for (const [name, value] of Object.entries(answer.headers)) {
        answerHeaders.set(name, Array.isArray(value) ? value.join(", ") : String(value));
    }
    //
    // A response Node read off a connection always has its status.
    //
    const status = answer.statusCode;
    assert(status !== undefined, `${url.href} answered with no status.`);
    const isBodyless = status === 204 || status === 304;
    if (isBodyless) {
        answer.resume();
        return new Response(null, {
            status,
            headers: answerHeaders,
        });
    }
    const streamed = new ReadableStream<Uint8Array>({
        start(controller): void {
            answer.on("data", (chunk: Buffer) => {
                controller.enqueue(new Uint8Array(chunk));
            });
            answer.on("end", () => {
                controller.close();
            });
            answer.on("error", (error: Error) => {
                controller.error(new TypeError("terminated", {
                    cause: error,
                }));
            });
        },
    });
    return new Response(streamed, {
        status,
        headers: answerHeaders,
    });
}

// The network one run owns.
export class RunNetwork {
    // What decides which calls go wrong.
    private readonly injector: Injector;

    // The servers of the run that are listening, by the port each listens on. A request from inside
    // the run to one of these ports, on this machine, is carried to the server in memory, so a
    // program that serves and asks itself, such as one waiting for a browser to come back to it, or
    // a scenario standing in for a service, works as it would.
    private readonly servers = new Map<number, ILoopbackServer>();

    // The next port a server that asks for any port is given.
    private nextPort = firstGivenPort;

    // How many requests to servers of the run are under way. Their bytes go through memory a turn
    // of the event loop at a time, so the run holds the call's timers back until they are done:
    // otherwise a timeout the call set would run out, in simulated time, before its own server had
    // answered.
    private exchanges = 0;

    // Counts one request to a server of the run as under way.
    startExchange(): void {
        this.exchanges += 1;
        assert(this.exchanges > 0);
    }

    // Counts one request to a server of the run as done.
    endExchange(): void {
        assert(this.exchanges > 0, "A request to a server of the run ended that was never started.");
        this.exchanges -= 1;
    }

    // Whether any request to a server of the run is under way.
    isExchanging(): boolean {
        assert(this.exchanges >= 0);
        return this.exchanges > 0;
    }

    // How many writes and ends the connections to servers of the run have carried, which goes up
    // while an exchange is moving.
    private activity = 0;

    // Counts one write or end on a connection to a server of the run.
    noteActivity(): void {
        this.activity += 1;
        assert(this.activity > 0);
    }

    // How many writes and ends the connections to servers of the run have carried so far.
    activityCount(): number {
        assert(this.activity >= 0);
        return this.activity;
    }

    constructor(injector: Injector) {
        this.injector = injector;
    }

    // Starts `server` listening on `port`, or on a port of its own when `port` is 0, and gives the
    // port it listens on.
    listenAt(port: number, server: ILoopbackServer): number {
        let given = port;
        if (given === 0) {
            given = this.nextPort;
            this.nextPort += 1;
        }
        this.servers.set(given, server);
        assert(this.servers.get(given) === server);
        return given;
    }

    // Stops whatever listens on `port`.
    stopListening(port: number): void {
        this.servers.delete(port);
        assert(!this.servers.has(port));
    }

    // The server of the run a request to `host` and `port` reaches, or none when the request leaves
    // the machine or no server of the run listens there.
    serverAt(host: string, port: number): ILoopbackServer | undefined {
        if (!isLoopback(host)) {
            return undefined;
        }
        return this.servers.get(port);
    }

    // Asks the injector whether one network call fails, with the failures `possible` there.
    check(possible: string[]): string | undefined {
        return this.injector.check("network", possible);
    }

    // Asks whether a call given `signal` is aborted.
    isAborted(signal: AbortSignal | undefined): boolean {
        return isAborted(this.injector, signal);
    }

    // Answers `fetch`, the way Node's own `fetch` answers: a failure to connect rejects with a
    // `TypeError` whose `cause` carries the code, and every other failure is in the answer.
    async fetch(input: string | URL | Request, init: RequestInit | undefined): Promise<Response> {
        const address = input instanceof Request ? input.url : String(input);
        const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
        if (this.isAborted(signal ?? undefined)) {
            throw new DOMException("This operation was aborted", "AbortError");
        }
        const failure = this.check(requestFailures);
        //
        // A request to a server of the run is a place like any other, so it fails the way a request
        // fails when a failure is injected there, and reaches the server when none is.
        //
        if (failure === undefined) {
            const url = new URL(address);
            const server = this.serverAt(url.hostname, portOf(url));
            if (server) {
                this.startExchange();
                return fetchFrom(server, url, input instanceof Request ? input : new Request(address, init), () => this.noteActivity(), () => this.endExchange());
            }
        }
        const answer = httpAnswer(failure);
        if (answer === undefined) {
            throw new TypeError("fetch failed", {
                cause: connectError(failure!, hostOf(address)),
            });
        }
        if (answer.resetsAfterHeaders) {
            const reset = connectError("connection-reset-part-way-through", hostOf(address));
            const body = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.error(new TypeError("terminated", {
                        cause: reset,
                    }));
                },
            });
            return new Response(body, {
                status: answer.status,
                headers: answer.headers,
            });
        }
        return new Response(answer.body.length === 0 ? null : new Uint8Array(answer.body), {
            status: answer.status,
            headers: answer.headers,
        });
    }
}

