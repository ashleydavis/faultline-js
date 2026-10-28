// Tests for the replacement of `node:net`.
//
// The goal is to show that a connection reaches no machine: it is accepted and the other end sends
// no data with no failure planned. It fails as `docs/FAILURES.md` says with each failure planned at
// its place. A server listens on no port and takes no connection. With no run in flight a
// connection goes to the real module, whose `createConnection` is replaced here by a stand-in, so
// the test checks it is handed on with the same arguments and its answer handed back. The method is
// to put a run in flight, connect or listen the way code under test does and read back what the
// socket or server emitted.

import assert from "node:assert/strict";
import { once } from "node:events";
import realNet from "node:net";
import { describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import type { PlannedFailure } from "../injector.ts";
import { connectFailures } from "../network.ts";
import { RunSubject } from "../subject.ts";
import net, { Server, Socket, Stream } from "./net.ts";

// The real module with `createConnection` replaced by a stand-in that connects nowhere and answers
// with a value of its own.
jest.mock("node:net", () => ({
    ...jest.requireActual<typeof realNet>("node:net"),
    createConnection: jest.fn(() => "real connection"),
}));

// The stand-in above, as the test reads it back.
const realModule = jest.requireMock<Record<string, jest.Mock>>("node:net");

// A callback a call is handed, which nothing calls while the real module is stood in for.
export function ignoreAnswer(): void {
    return undefined;
}

// Runs `work` with one run in flight and waits for it. The run injects `planned`, or nothing when
// it is undefined.
export async function runInFlight<T>(work: (subject: RunSubject) => T | Promise<T>, planned: PlannedFailure | undefined): Promise<T> {
    const subject = new RunSubject(1, planned);
    const before = runWith(subject);
    try {
        return await work(subject);
    }
    finally {
        runWith(before);
    }
}

// Runs `work` with one run in flight that injects nothing and waits for it.
export function runWithNoFailure<T>(work: (subject: RunSubject) => T | Promise<T>): Promise<T> {
    return runInFlight(work, undefined);
}

// The failure planned for the first network call.
export function firstNetworkFailure(failure: string): PlannedFailure {
    return {
        place: {
            effect: "network",
            occurrence: 0,
        },
        failure,
    };
}

// The code of an error a socket or server emitted, which Node always gives one. The error's type
// does not declare the field, so it is checked for before it is read.
export function errorCode(error: unknown): string {
    assert.ok(error instanceof Error);
    assert.ok("code" in error);
    assert.equal(typeof error.code, "string");
    return String(error.code);
}

describe("connections", () => {
    test("a connection is accepted and the other end sends no data", async () => {
        await runWithNoFailure(async (subject) => {
            const heard: string[] = [];
            const socket = net.createConnection(80, "example.com", () => heard.push("connected"));
            socket.on("data", () => heard.push("data"));
            socket.on("end", () => heard.push("end"));
            await once(socket, "ready");
            assert.deepEqual(heard, ["connected"]);
            assert.equal(socket.remoteAddress, "127.0.0.1");
            assert.equal(socket.remotePort, 80);
            assert.equal(socket.connecting, false);
            assert.deepEqual(subject.injector.reached, [
                {
                    place: {
                        effect: "network",
                        occurrence: 0,
                    },
                    failures: connectFailures,
                },
            ]);
        });
    });

    test("a connection made with its options as an object reads the port and host from them", async () => {
        const socket = await runWithNoFailure(async () => {
            const made = net.connect({
                port: 5432,
                host: "db",
            });
            await once(made, "connect");
            return made;
        });
        assert.equal(socket.remotePort, 5432);
    });

    // The code Node gives each failure that stops a connection being made.
    for (const [failure, code] of Object.entries({
        "name-does-not-resolve": "ENOTFOUND",
        "connection-refused": "ECONNREFUSED",
        "connection-times-out": "ETIMEDOUT",
        "network-unreachable": "ENETUNREACH",
        "host-unreachable": "EHOSTUNREACH",
        "connection-aborted": "ECONNABORTED",
    })) {
        test(`${failure} emits an error with ${code} and closes`, async () => {
            await runInFlight(async () => {
                const socket = net.createConnection(80, "example.com");
                const [error] = await once(socket, "error");
                assert.equal(errorCode(error), code);
                assert.equal(socket.destroyed, true);
            }, firstNetworkFailure(failure));
        });
    }

    test("a connection reset part way through connects, then emits ECONNRESET", async () => {
        const seen = await runInFlight(async () => {
            const heard: string[] = [];
            const socket = net.createConnection(80, "example.com");
            socket.on("connect", () => heard.push("connected"));
            const [error] = await once(socket, "error");
            heard.push(errorCode(error));
            return heard;
        }, firstNetworkFailure("connection-reset-part-way-through"));
        assert.deepEqual(seen, ["connected", "ECONNRESET"]);
    });

    test("what is written goes nowhere and ending or giving up closes the connection", async () => {
        const seen = await runWithNoFailure(async () => {
            const heard: string[] = [];
            const socket = new Socket().connect(80);
            assert.equal(socket.write("x", () => heard.push("written")), true);
            assert.equal(socket.write("y", "utf8", () => heard.push("written again")), true);
            for (const call of [socket.setTimeout, socket.setNoDelay, socket.setKeepAlive, socket.setEncoding, socket.ref, socket.unref, socket.pause, socket.resume]) {
                assert.equal(call.call(socket), socket);
            }
            socket.end();
            await once(socket, "close");
            const broken = new Stream();
            broken.on("error", (error: Error) => heard.push(error.message));
            const brokenClosed = new Promise((done) => broken.on("close", done));
            broken.destroy(new Error("given up"));
            await brokenClosed;
            const quiet = new Socket();
            quiet.destroy();
            await once(quiet, "close");
            return heard;
        });
        assert.deepEqual(seen, ["written", "written again", "given up"]);
    });

    test("a connection named by its host alone has no port and a write with no callback is taken", async () => {
        const socket = await runWithNoFailure(async () => {
            const made = new Socket().connect("example.com");
            assert.equal(made.write("x"), true);
            await once(made, "connect");
            return made;
        });
        assert.equal(socket.remotePort, undefined);
    });

    test("with no run in flight a connection is handed to the real module with its arguments and its answer comes back", () => {
        assert.equal(net.createConnection(9, "127.0.0.1", ignoreAnswer), "real connection");
        assert.deepEqual(Array.from(realModule.createConnection.mock.lastCall ?? []), [9, "127.0.0.1", ignoreAnswer]);
    });
});

describe("servers", () => {
    test("a server says it is listening without opening a port and takes no connection", async () => {
        await runWithNoFailure(async () => {
            let connected = 0;
            const server = net.createServer(() => {
                connected += 1;
            });
            assert.ok(server instanceof Server);
            await new Promise<void>((done) => {
                server.listen(9000, () => done());
            });
            assert.equal(server.listening, true);
            assert.equal(server.address().port, 0);
            assert.equal(server.ref(), server);
            assert.equal(server.unref(), server);
            await new Promise<void>((done) => {
                server.close(() => done());
            });
            server.close();
            assert.equal(server.listening, false);
            assert.equal(connected, 0);
        });
    });

    test("a server's handler runs when a connection is emitted on it, as a scenario does", () => {
        let connected = 0;
        const server = net.createServer({}, () => {
            connected += 1;
        });
        server.emit("connection", new Socket());
        net.createServer();
        assert.equal(connected, 1);
    });

    test("a server listening with no callback says so by its event", async () => {
        await runWithNoFailure(async () => {
            const server = net.createServer();
            server.listen(0);
            await once(server, "listening");
            assert.equal(server.listening, true);
        });
    });

    test("a server that cannot listen emits the error the injector chose", async () => {
        const [error] = await runInFlight(async () => {
            const server = net.createServer();
            server.listen();
            return once(server, "error");
        }, firstNetworkFailure("address-not-available"));
        assert.equal(errorCode(error), "EADDRNOTAVAIL");
    });

    test("the default export keeps the real module's address helpers", () => {
        assert.equal(net.isIP, realNet.isIP);
    });
});
