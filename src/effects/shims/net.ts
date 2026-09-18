// What the copy imports in place of `node:net`.
//
// A connection a run opens reaches no machine. It connects until the injector says this call goes
// wrong, and then it fails the way a real connection fails.

import { EventEmitter } from "node:events";
import { nowRunning } from "../current.ts";
import { CodedError } from "../effects.ts";

// One connection, as `node:net` hands it back. What is written to it goes nowhere, and what it
// answers with is what the injector said.
class Socket extends EventEmitter {
    // Where the connection was aimed, for the error a failure carries.
    private where = "localhost";

    // Opens the connection, or fails the way a real one fails.
    connect(...args: unknown[]): this {
        const port = args.find((one) => typeof one === "number");
        const host = args.find((one) => typeof one === "string") ?? "localhost";
        const done = args.find((one) => typeof one === "function") as (() => void) | undefined;
        this.where = port === undefined ? String(host) : `${String(host)}:${String(port)}`;
        const failure = nowRunning()?.injector.check("net");
        queueMicrotask(() => {
            if (failure === "refused") {
                this.emit("error", new CodedError("ECONNREFUSED", `connect ECONNREFUSED ${this.where}`));
                return;
            }
            if (failure === "timeout") {
                this.emit("error", new CodedError("ETIMEDOUT", `connect ETIMEDOUT ${this.where}`));
                return;
            }
            if (failure === "dns") {
                this.emit("error", new CodedError("ENOTFOUND", `getaddrinfo ENOTFOUND ${this.where}`));
                return;
            }
            if (done !== undefined) {
                done();
            }
            this.emit("connect");
            if (failure === "server-error") {
                this.emit("error", new CodedError("ECONNRESET", `read ECONNRESET ${this.where}`));
                return;
            }
            this.emit("data", Buffer.from(failure === "bad-body" ? "\u0000\u0000" : "ok"));
            this.emit("end");
        });
        return this;
    }

    // Takes part of what is being sent. Nothing leaves this process.
    write(): boolean {
        return true;
    }

    // Says there is no more to send.
    end(): this {
        queueMicrotask(() => this.emit("close"));
        return this;
    }

    // Gives up on the connection.
    destroy(): this {
        return this;
    }

    // Says how long the connection may sit idle. Nothing here waits, so it never runs out.
    setTimeout(): this {
        return this;
    }

    // Says whether small writes are held back. Nothing is sent, so it changes none of it.
    setNoDelay(): this {
        return this;
    }
}

export function createConnection(...args: unknown[]): Socket {
    return new Socket().connect(...args);
}

export function connect(...args: unknown[]): Socket {
    return createConnection(...args);
}

// A server the code under test creates. It listens on nothing, so the run gets past whatever made
// it.
class Server extends EventEmitter {
    listen(...args: unknown[]): this {
        const done = args.find((one) => typeof one === "function") as (() => void) | undefined;
        if (done !== undefined) {
            queueMicrotask(done);
        }
        queueMicrotask(() => this.emit("listening"));
        return this;
    }

    close(done?: () => void): this {
        if (done !== undefined) {
            queueMicrotask(done);
        }
        return this;
    }

    address(): { address: string; family: string; port: number } {
        return { address: "127.0.0.1", family: "IPv4", port: 0 };
    }
}

export function createServer(handler?: (socket: Socket) => void): Server {
    const made = new Server();
    if (handler !== undefined) {
        made.on("connection", handler);
    }
    return made;
}

export { Server, Socket };

// What `import net from "node:net"` gets.
export default { createConnection, connect, createServer, Server, Socket };
