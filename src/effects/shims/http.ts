// What the copy imports in place of `node:http` and `node:https`.
//
// A request a run makes reaches no machine. It answers with a small response until the injector
// says this call goes wrong, and then it fails the way a real request fails: a refused connection,
// a name that will not resolve, a request that times out, a server error, a body that will not
// parse.
//
// Only the client half is replaced. A server the code under test creates listens on nothing and
// hands its handler back, so whatever made the server still runs.

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { nowRunning } from "../current.ts";
import { CodedError } from "../effects.ts";

// Everything the real module has and this one does not replace. A name a project imports and this
// file does not hand out would stop the import outright, and a name declared here wins over the
// one the star brings in.
export * from "node:http";

// The body a working request answers with. It parses as JSON and reads as text, so a caller that
// does either gets something it understands.
const answersWith = '{"ok":true}';

// The body a request that answers badly gets. It is the case a caller that parses without catching
// gets wrong.
const answersBadly = "<html>not json</html>";

// What the injector asked of this request, written as the error it becomes or the answer it gives.
function failureNow(): string | undefined {
    return nowRunning()?.injector.check("net");
}

// The error one failure throws, or nothing for a failure that answers rather than throwing.
function errorFor(failure: string | undefined, host: string): Error | undefined {
    if (failure === "refused") {
        return new CodedError("ECONNREFUSED", `connect ECONNREFUSED ${host}`);
    }
    if (failure === "timeout") {
        return new CodedError("ETIMEDOUT", `connect ETIMEDOUT ${host}`);
    }
    if (failure === "dns") {
        return new CodedError("ENOTFOUND", `getaddrinfo ENOTFOUND ${host}`);
    }
    return undefined;
}

// One answer, as the readable stream `node:http` hands a caller.
class IncomingMessage extends Readable {
    // The status the server answered with.
    readonly statusCode: number;

    // What the status means, as the runtime words it.
    readonly statusMessage: string;

    // What the server sent back with it.
    readonly headers: Record<string, string>;

    // What is left of the body to hand out.
    private left: string;

    constructor(statusCode: number, body: string) {
        super();
        this.statusCode = statusCode;
        this.statusMessage = statusCode === 200 ? "OK" : "Internal Server Error";
        this.headers = { "content-type": "application/json" };
        this.left = body;
    }

    override _read(): void {
        if (this.left === "") {
            this.push(null);
            return;
        }
        this.push(this.left);
        this.left = "";
    }
}

// One request, as `node:http` hands it back. What is written to it goes nowhere, and the answer
// arrives once the caller has asked for it to be sent.
class ClientRequest extends EventEmitter {
    // Where the request was aimed, for the error a failure carries.
    private readonly host: string;

    // Whether the answer has been given, so ending twice answers once.
    private answered = false;

    constructor(host: string, callback?: (answer: IncomingMessage) => void) {
        super();
        this.host = host;
        if (callback !== undefined) {
            this.on("response", callback);
        }
    }

    // Takes part of the body. Nothing is sent anywhere, and the call answers the way a write to a
    // socket that took everything answers.
    write(): boolean {
        return true;
    }

    // Sends the request and brings back the answer, or the failure the injector asked for.
    end(): this {
        if (this.answered) {
            return this;
        }
        this.answered = true;
        const failure = failureNow();
        const error = errorFor(failure, this.host);
        queueMicrotask(() => {
            if (error !== undefined) {
                this.emit("error", error);
                return;
            }
            if (failure === "server-error") {
                this.emit("response", new IncomingMessage(500, '{"error":"server"}'));
                return;
            }
            this.emit("response", new IncomingMessage(200, failure === "bad-body" ? answersBadly : answersWith));
        });
        return this;
    }

    // Gives up on the request, the way a caller that has waited long enough does.
    destroy(): this {
        this.answered = true;
        return this;
    }

    // Says how long the request may take. Nothing here waits, so the deadline never arrives.
    setTimeout(): this {
        return this;
    }
}

// Where a request was aimed, read from whichever of the several ways a caller says it.
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
    const held = target as { host?: string; hostname?: string; port?: number } | undefined;
    return held?.host ?? held?.hostname ?? "localhost";
}

export function request(target: unknown, options?: unknown, callback?: unknown): ClientRequest {
    const done = (typeof options === "function" ? options : callback) as ((answer: IncomingMessage) => void) | undefined;
    return new ClientRequest(hostOf(target), done);
}

export function get(target: unknown, options?: unknown, callback?: unknown): ClientRequest {
    return request(target, options, callback).end();
}

export type { IncomingMessage as Answer };

// A server the code under test creates. It listens on nothing, so the run gets past whatever made
// it, and it keeps the handler so the request handling is reached by calling it.
class Server extends EventEmitter {
    // What the server was given to answer requests with.
    readonly handler?: (request: unknown, response: unknown) => void;

    constructor(handler?: (request: unknown, response: unknown) => void) {
        super();
        this.handler = handler;
        if (handler !== undefined) {
            // The runtime registers what `createServer` was given as a listener for a request, and
            // so does this, so a server answers the one way whichever it was given.
            this.on("request", handler);
        }
    }

    // Takes the address the caller asked for and tells it the server is up, without a socket being
    // opened anywhere.
    listen(...args: unknown[]): this {
        const done = args.find((one) => typeof one === "function") as (() => void) | undefined;
        if (done !== undefined) {
            queueMicrotask(done);
        }
        queueMicrotask(() => {
            this.emit("listening");
            this.takeRequests();
        });
        return this;
    }

    // Takes the requests the run made up, once the server is up.
    //
    // A project that writes a handler for a request is handed none by a server that opens no
    // socket, so every line inside the handler went unreached. The paths asked for are the strings
    // the file being measured names, so a handler that answers one path one way and another
    // another way is asked for each of them.
    private takeRequests(): void {
        for (const asked of nowRunning()?.events.texts() ?? []) {
            if (this.listenerCount("request") === 0) {
                return;
            }
            try {
                this.emit("request", new ServerRequest(asked), new ServerAnswer());
            }
            catch {
                // A handler that throws on one made up request stops that request and no more. The
                // lines it ran before it threw are the ones this is after, and each request after
                // it has lines of its own to reach.
            }
        }
    }

    // Shuts the server down, which takes nothing down because nothing was opened.
    close(done?: () => void): this {
        if (done !== undefined) {
            queueMicrotask(done);
        }
        return this;
    }

    // Says the server takes no address of its own.
    address(): { address: string; family: string; port: number } {
        return { address: "127.0.0.1", family: "IPv4", port: 0 };
    }
}

// One request a server took, as `node:http` hands it to a handler.
class ServerRequest extends Readable {
    // What the request asked for.
    readonly url: string;

    // How it asked for it.
    readonly method = "GET";

    // What it sent with it.
    readonly headers: Record<string, string> = { host: "127.0.0.1", "content-type": "application/json" };

    constructor(url: string) {
        super();
        this.url = url;
    }

    override _read(): void {
        this.push(null);
    }
}

// What a handler writes its answer to. What is written goes nowhere: no socket was opened, and the
// answer is read by whoever asked for it in the code under test rather than sent.
class ServerAnswer extends EventEmitter {
    // The status the handler set, which starts at what the runtime starts it at.
    statusCode = 200;

    // Whether the head has gone, so a handler that reads it back reads what it would read.
    headersSent = false;

    // What the handler set, by name.
    private readonly headers: Record<string, unknown> = {};

    // Writes the status and the headers.
    writeHead(status: number, headers?: Record<string, unknown>): this {
        this.statusCode = status;
        Object.assign(this.headers, headers ?? {});
        this.headersSent = true;
        return this;
    }

    // Sets one header.
    setHeader(name: string, value: unknown): this {
        this.headers[name.toLowerCase()] = value;
        return this;
    }

    // Reads one back.
    getHeader(name: string): unknown {
        return this.headers[name.toLowerCase()];
    }

    // Takes part of the body, which goes nowhere.
    write(): boolean {
        return true;
    }

    // Ends the answer, which is what a handler does last.
    end(): this {
        this.headersSent = true;
        this.emit("finish");
        this.emit("close");
        return this;
    }
}

export function createServer(options?: unknown, handler?: unknown): Server {
    const found = (typeof options === "function" ? options : handler) as ((request: unknown, response: unknown) => void) | undefined;
    return new Server(found);
}

export { ClientRequest, IncomingMessage, Server, ServerAnswer, ServerRequest };

// The status codes `node:http` carries, for code that reads one off the module.
export const STATUS_CODES: Record<number, string> = { 200: "OK", 404: "Not Found", 500: "Internal Server Error" };

// What `import http from "node:http"` gets.
export default { request, get, createServer, ClientRequest, IncomingMessage, Server, STATUS_CODES };
