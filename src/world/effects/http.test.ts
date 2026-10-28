// Tests for the replacement of `node:http` and `node:https`.
//
// The goal is to show that a request reaches no machine: it gets status 200 and an empty body with
// no failure planned. It fails as `docs/FAILURES.md` says with each failure planned at its place. A
// server listens on no port and takes no request. The method is to put a run in flight, make the
// calls the way code under test makes them and read back what arrived. With no run in flight a
// request goes to the real module, whose `request` and `get` are replaced here by stand-ins, so the
// test checks each is handed on with the same arguments and its answer handed back.

import assert from "node:assert/strict";
import { once } from "node:events";
import realHttp from "node:http";
import type { RequestOptions } from "node:http";
import { describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import type { PlannedFailure } from "../injector.ts";
import { requestFailures } from "../network.ts";
import { RunSubject } from "../subject.ts";
import http, { ClientRequest, RunResponse, Server } from "./http.ts";

// The real module with `request` and `get` replaced by stand-ins that connect nowhere and answer
// with a value of their own.
jest.mock("node:http", () => ({
    ...jest.requireActual<typeof realHttp>("node:http"),
    request: jest.fn(() => "real request"),
    get: jest.fn(() => "real get"),
}));

// The stand-ins above, as the test reads them back.
const realModule = jest.requireMock<Record<string, jest.Mock>>("node:http");

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

// The field `name` of an error a request or a server emitted.
export function errorField(error: unknown, name: string): unknown {
    assert.ok(error instanceof Error);
    return Reflect.get(error, name);
}

// What a request came back with.
export interface IRequested {
    // The answer, when one arrived.
    answer: RunResponse | undefined;

    // The body read from the answer, when all of it arrived.
    body: string | undefined;

    // The error the request or its answer emitted, when one did.
    error: Error | undefined;
}

// Sends a request to `target` and reads what came back: its answer and body, or its error.
export async function sendRequest(target: string | URL | RequestOptions): Promise<IRequested> {
    return new Promise((settle) => {
        const request = http.get(target, (answer: RunResponse) => {
            let body = "";
            answer.on("data", (piece: Buffer) => {
                body += piece.toString("utf8");
            });
            answer.on("end", () => settle({
                answer,
                body,
                error: undefined,
            }));
            answer.on("error", (error: Error) => settle({
                answer,
                body: undefined,
                error,
            }));
        });
        request.on("error", (error: Error) => settle({
            answer: undefined,
            body: undefined,
            error,
        }));
    });
}

describe("requests", () => {
    test("a request with no failure planned gets status 200 and an empty body", async () => {
        const { answer, body } = await runWithNoFailure(() => sendRequest("http://example.com/"));
        assert.ok(answer);
        assert.equal(answer.statusCode, 200);
        assert.equal(answer.statusMessage, "OK");
        assert.equal(answer.httpVersion, "1.1");
        assert.equal(body, "");
        assert.equal(answer.setTimeout(), answer);
    });

    test("a request is one place, where every failure a request can have can happen", async () => {
        const reached = await runWithNoFailure(async (subject) => {
            await sendRequest(new URL("https://example.com/"));
            return subject.injector.reached;
        });
        assert.deepEqual(reached, [
            {
                place: {
                    effect: "network",
                    occurrence: 0,
                },
                failures: requestFailures,
            },
        ]);
    });

    // The code Node gives each failure that stops a request connecting.
    for (const [failure, code] of Object.entries({
        "name-does-not-resolve": "ENOTFOUND",
        "connection-refused": "ECONNREFUSED",
        "connection-times-out": "ETIMEDOUT",
        "network-unreachable": "ENETUNREACH",
        "host-unreachable": "EHOSTUNREACH",
        "connection-aborted": "ECONNABORTED",
    })) {
        test(`${failure} emits an error with ${code}`, async () => {
            const { error } = await runInFlight(() => sendRequest({
                hostname: "example.com",
            }), firstNetworkFailure(failure));
            assert.equal(errorField(error, "code"), code);
        });
    }

    test("a connection reset part way through answers and reading the body fails with ECONNRESET", async () => {
        const { answer, error } = await runInFlight(() => sendRequest("http://example.com/"), firstNetworkFailure("connection-reset-part-way-through"));
        assert.ok(answer);
        assert.equal(answer.statusCode, 200);
        assert.equal(errorField(error, "code"), "ECONNRESET");
    });

    test("a short response sends less than its content-length says", async () => {
        const { answer, body } = await runInFlight(() => sendRequest("http://example.com/"), firstNetworkFailure("short-response"));
        assert.ok(answer);
        assert.ok(body !== undefined);
        assert.ok(body.length < Number(answer.headers["content-length"]));
    });

    test("a response that does not parse is sent as JSON and is not JSON", async () => {
        const { answer, body } = await runInFlight(() => sendRequest("http://example.com/"), firstNetworkFailure("response-that-does-not-parse"));
        assert.ok(answer);
        assert.ok(body !== undefined);
        assert.equal(answer.headers["content-type"], "application/json");
        assert.throws(() => JSON.parse(body));
    });

    test("a server error answers with status 500", async () => {
        const { answer } = await runInFlight(() => sendRequest("http://example.com/"), firstNetworkFailure("server-error"));
        assert.ok(answer);
        assert.equal(answer.statusCode, 500);
        assert.equal(answer.statusMessage, "Internal Server Error");
    });

    test("a request given a signal can be aborted at its place", async () => {
        const error = await runInFlight(() => new Promise<Error>((settle) => {
            const request = http.request("http://example.com/", {
                signal: new AbortController().signal,
            });
            request.on("error", (failed: Error) => settle(failed));
            request.end();
        }), {
            place: {
                effect: "cancellation",
                occurrence: 0,
            },
            failure: "operation-aborted",
        });
        assert.equal(error.name, "AbortError");
    });

    test("a request takes writes that go nowhere, is ended once and calls back", async () => {
        await runWithNoFailure(async (subject) => {
            const called: string[] = [];
            const request = http.request({
                host: "example.com",
                signal: undefined,
            }, () => called.push("answered"));
            assert.ok(request instanceof ClientRequest);
            assert.equal(request.write("body", () => called.push("written")), true);
            assert.equal(request.write("no callback"), true);
            assert.equal(request.write("more", "utf8", () => called.push("written again")), true);
            assert.equal(request.setHeader(), request);
            assert.equal(request.getHeader(), undefined);
            request.removeHeader();
            request.flushHeaders();
            assert.equal(request.setTimeout(), request);
            request.setNoDelay();
            request.setSocketKeepAlive();
            request.end(() => called.push("ended"));
            request.end();
            await new Promise((settle) => setImmediate(settle));
            assert.deepEqual(called, ["written", "written again", "ended", "answered"]);
            assert.equal(subject.injector.reached.length, 1);
        });
    });

    test("a request given up on before it is answered hears nothing, or the error it was given up with", async () => {
        const heard = await runWithNoFailure(async () => {
            const said: string[] = [];
            const quiet = http.request("http://example.com/", () => said.push("answered"));
            quiet.end();
            quiet.abort();
            const loud = http.request("http://example.com/");
            loud.on("error", (error: Error) => said.push(error.message));
            loud.destroy(new Error("given up"));
            await new Promise((settle) => setImmediate(settle));
            return said;
        });
        assert.deepEqual(heard, ["given up"]);
    });

    test("a request aimed by its host alone, or at nothing named, is aimed at that host or at localhost", async () => {
        const errors = await runInFlight(async () => {
            const seen: string[] = [];
            for (const target of [
                {
                    host: "by-host",
                },
                undefined,
            ]) {
                const request = http.request(target);
                request.on("error", (error: Error) => seen.push(error.message));
                request.end();
            }
            await new Promise((settle) => setImmediate(settle));
            return seen;
        }, firstNetworkFailure("connection-refused"));
        assert.deepEqual(errors, ["connect ECONNREFUSED by-host"]);
    });

    test("a request ended once its run is over sends nothing", async () => {
        const request = await runWithNoFailure(() => http.request("not a url"));
        let heard = 0;
        request.on("response", () => {
            heard += 1;
        });
        assert.equal(request.end(), request);
        await new Promise((settle) => setImmediate(settle));
        assert.equal(heard, 0);
    });

    test("with no run in flight a request is handed to the real module with its arguments and its answer comes back", () => {
        const options = {
            method: "GET",
        };
        assert.equal(http.request("http://127.0.0.1:9/", options, ignoreAnswer), "real request");
        assert.deepEqual(Array.from(realModule.request.mock.lastCall ?? []), ["http://127.0.0.1:9/", options, ignoreAnswer]);
        assert.equal(http.get("http://127.0.0.1:9/", options, ignoreAnswer), "real get");
        assert.deepEqual(Array.from(realModule.get.mock.lastCall ?? []), ["http://127.0.0.1:9/", options, ignoreAnswer]);
    });
});

describe("servers", () => {
    test("a server listens on the port it asked for on the run's network and takes no request unasked", async () => {
        await runWithNoFailure(async () => {
            let handled = 0;
            const server = http.createServer(() => {
                handled += 1;
            });
            assert.ok(server instanceof Server);
            await new Promise<void>((done) => {
                server.listen(8080, () => done());
            });
            assert.equal(server.listening, true);
            assert.deepEqual(server.address(), {
                address: "127.0.0.1",
                family: "IPv4",
                port: 8080,
            });
            assert.equal(server.setTimeout(), server);
            server.closeAllConnections();
            server.closeIdleConnections();
            await new Promise<void>((done) => {
                server.close(() => done());
            });
            assert.equal(server.listening, false);
            assert.equal(handled, 0);
        });
    });

    test("a server listening with no port and no callback says so by its event", async () => {
        await runWithNoFailure(async () => {
            const server = http.createServer();
            server.listen();
            await once(server, "listening");
            assert.equal(server.listening, true);
        });
    });

    test("a server's handler runs when a request is emitted on it, as a scenario does", () => {
        let handled = 0;
        const server = http.createServer({}, () => {
            handled += 1;
        });
        server.emit("request", {}, {});
        assert.equal(handled, 1);
        http.createServer().close();
    });

    test("a server that cannot listen emits the error the injector chose", async () => {
        const [error] = await runInFlight(async () => {
            const server = http.createServer();
            server.listen(80);
            return once(server, "error");
        }, firstNetworkFailure("address-already-in-use-when-listening"));
        assert.equal(errorField(error, "code"), "EADDRINUSE");
    });

    test("the default export keeps the real module's constants", () => {
        assert.equal(http.STATUS_CODES, realHttp.STATUS_CODES);
        assert.equal(http.METHODS, realHttp.METHODS);
    });
});
