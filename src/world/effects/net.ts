// What the copy imports in place of `node:net`.
//
// A connection a run opens reaches no machine. Unless a failure is injected it is accepted and the
// other end sends no data. When one is, it fails the way a real connection fails.

import { EventEmitter } from "node:events";
import realNet from "node:net";
import { nowRunning } from "../current.ts";
import { codeOf, networkError } from "../effects.ts";
import { connectError, connectFailures, listenFailures } from "../network.ts";

// Everything the real module has and this one does not replace: the address helpers. Every call
// that reaches the network is declared below, and a name declared here wins over the one the star
// brings in.
export * from "node:net";

// One connection, as `node:net` hands it back. What is written to it goes nowhere.
class Socket extends EventEmitter {
    // Where the connection was aimed, for the error a failure carries.
    private where = "localhost";

    // Whether the connection is open.
    connecting = false;

    // Whether the caller gave up on the connection.
    destroyed = false;

    // The address the other end is on, once connected.
    remoteAddress: string | undefined;

    // The port the other end is on, once connected.
    remotePort: number | undefined;

    // Opens the connection, or fails the way a real one fails.
    connect(...args: unknown[]): this {
        const first = args[0];
        const given = first !== null && typeof first === "object" ? (first as { port?: number; host?: string }) : undefined;
        const port = given?.port ?? args.find((one) => typeof one === "number");
        const host = given?.host ?? args.find((one) => typeof one === "string") ?? "localhost";
        const done = args.find((one) => typeof one === "function") as (() => void) | undefined;
        this.where = port === undefined ? String(host) : `${String(host)}:${String(port)}`;
        this.connecting = true;
        const failure = nowRunning()?.network.check(connectFailures);
        queueMicrotask(() => {
            this.connecting = false;
            if (failure !== undefined && failure !== "connection-reset-part-way-through") {
                this.destroyed = true;
                this.emit("error", connectError(failure, this.where));
                this.emit("close", true);
                return;
            }
            this.remoteAddress = "127.0.0.1";
            this.remotePort = typeof port === "number" ? port : undefined;
            if (done !== undefined) {
                done();
            }
            this.emit("connect");
            this.emit("ready");
            if (failure === "connection-reset-part-way-through") {
                this.destroyed = true;
                this.emit("error", connectError(failure, this.where));
                this.emit("close", true);
            }
        });
        return this;
    }

    // Takes part of what is being sent, which goes nowhere.
    write(_chunk?: unknown, _encoding?: unknown, done?: unknown): boolean {
        const callback = typeof _encoding === "function" ? _encoding : done;
        if (typeof callback === "function") {
            queueMicrotask(() => (callback as () => void)());
        }
        return true;
    }

    // Says there is no more to send.
    end(): this {
        queueMicrotask(() => {
            this.emit("finish");
            this.emit("close", false);
        });
        return this;
    }

    // Gives up on the connection.
    destroy(error?: Error): this {
        this.destroyed = true;
        queueMicrotask(() => {
            if (error !== undefined) {
                this.emit("error", error);
            }
            this.emit("close", error !== undefined);
        });
        return this;
    }

    // Says how long the connection may sit idle. Simulated time moves only for timers, so it never
    // runs out.
    setTimeout(): this {
        return this;
    }

    setNoDelay(): this {
        return this;
    }

    setKeepAlive(): this {
        return this;
    }

    setEncoding(): this {
        return this;
    }

    ref(): this {
        return this;
    }

    unref(): this {
        return this;
    }

    pause(): this {
        return this;
    }

    resume(): this {
        return this;
    }
}

export function createConnection(...args: unknown[]): Socket {
    if (nowRunning() === undefined) {
        return (realNet.createConnection as (...given: unknown[]) => unknown)(...args) as unknown as Socket;
    }
    return new Socket().connect(...args);
}

export function connect(...args: unknown[]): Socket {
    return createConnection(...args);
}

// A server the code under test creates. It listens on no port and takes no connection, so the run
// gets past whatever made it.
class Server extends EventEmitter {
    // Whether the server is listening.
    listening = false;

    listen(...args: unknown[]): this {
        const done = args.find((one) => typeof one === "function") as (() => void) | undefined;
        const port = args.find((one) => typeof one === "number") ?? 0;
        const failure = nowRunning()?.network.check(listenFailures);
        queueMicrotask(() => {
            if (failure !== undefined) {
                this.emit("error", networkError(codeOf(failure), "listen", `:::${String(port)}`));
                return;
            }
            this.listening = true;
            if (done !== undefined) {
                done();
            }
            this.emit("listening");
        });
        return this;
    }

    close(done?: () => void): this {
        this.listening = false;
        queueMicrotask(() => {
            if (done !== undefined) {
                done();
            }
            this.emit("close");
        });
        return this;
    }

    address(): { address: string; family: string; port: number } {
        return {
            address: "127.0.0.1",
            family: "IPv4",
            port: 0,
        };
    }

    ref(): this {
        return this;
    }

    unref(): this {
        return this;
    }
}

export function createServer(options?: unknown, handler?: unknown): Server {
    const made = new Server();
    const found = typeof options === "function" ? options : handler;
    if (typeof found === "function") {
        made.on("connection", found as (socket: Socket) => void);
    }
    return made;
}

export { Server, Socket, Socket as Stream };

// What `import net from "node:net"` gets: the real module's address helpers with every call that
// reaches the network replaced.
export default {
    ...realNet,
    createConnection,
    connect,
    createServer,
    Server,
    Socket,
    Stream: Socket,
};
