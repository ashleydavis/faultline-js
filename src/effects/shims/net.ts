// What the copy imports in place of `node:net`.
//
// A connection a run opens reaches no machine. It connects until the injector says this call goes
// wrong, and then it fails the way a real connection fails.

import { EventEmitter } from "node:events";
import { nowRunning } from "../current.ts";
import { CodedError } from "../effects.ts";

// Everything the real module has and this one does not replace. A name a project imports and this
// file does not hand out would stop the import outright, and a name declared here wins over the
// one the star brings in.
export * from "node:net";

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
        queueMicrotask(() => {
            this.emit("listening");
            this.takeConnections();
        });
        return this;
    }

    // Takes the connections the run made up, once the server is up.
    //
    // A project that writes a handler for a connection is handed none by a server that opens no
    // socket, so every line inside the handler went unreached. One connection is taken per string
    // the file being measured names, and each sends that string, so a handler that reads what came
    // in and turns on it is given each of them.
    private takeConnections(): void {
        for (const said of nowRunning()?.events.texts() ?? []) {
            if (this.listenerCount("connection") === 0) {
                return;
            }
            const socket = new Socket();
            try {
                this.emit("connection", socket);
                socket.emit("data", Buffer.from(said));
                socket.emit("end");
                socket.emit("close");
            }
            catch {
                // A handler that throws on one made up connection stops that connection and no
                // more. The lines it ran before it threw are the ones this is after, and each
                // connection after it has lines of its own to reach.
            }
        }
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

// The name a caller building a connection by hand uses. It is the same thing as a socket.
export { Socket as Stream };

export { Server, Socket };

// What `import net from "node:net"` gets.
export default { createConnection, connect, createServer, Server, Socket, Stream: Socket };
