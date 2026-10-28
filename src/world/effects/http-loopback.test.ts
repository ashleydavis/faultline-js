//
// Checks that a request a run makes to a port a server of the same run listens on, on this machine,
// reaches that server and brings back what it answered. The goal is that a program that serves and
// asks itself, and a scenario standing in for a service, work as they would on a real port. The
// method is to start servers and send requests with the simulated `node:http` and `fetch` inside
// a run, and read what each end saw. The bytes go over an in-memory pair of streams, so no test
// opens a port.
//

import assert from "node:assert/strict";
import realHttp from "node:http";
import { afterEach, beforeEach, describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import { firstGivenPort, IdleTimeout, isLoopback, loopbackPair, portOf } from "../network.ts";
import { RunSubject } from "../subject.ts";
import http, { aimOf, connectLoopback, type Server } from "./http.ts";

//
// Runs `work` with one run in flight that injects nothing, and waits for it.
//
export async function runInRun<T>(work: (subject: RunSubject) => Promise<T>): Promise<T> {
    const subject = new RunSubject(1, undefined);
    const before = runWith(subject);
    try {
        return await work(subject);
    }
    finally {
        runWith(before);
    }
}

//
// A server of the run that answers every request with its method, path and body as JSON, listening
// on `port`, and the port it was given.
//
export async function startEchoServer(port: number): Promise<Server> {
    const server = http.createServer((request: realHttp.IncomingMessage, response: realHttp.ServerResponse) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
        });
        request.on("end", () => {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({
                method: request.method,
                path: request.url,
                body: Buffer.concat(chunks).toString("utf8"),
                host: request.headers.host,
            }));
        });
    });
    await new Promise<void>((done) => {
        server.listen(port, "127.0.0.1", () => done());
    });
    return server;
}

//
// What one request sent with the simulated `node:http` was answered with: its status and its body.
//
export function sendAndRead(target: string, method: string, body: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const sent = http.request(target, {
            method,
        }, (answer: realHttp.IncomingMessage) => {
            const chunks: Buffer[] = [];
            answer.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
            });
            answer.on("end", () => {
                resolve({
                    status: answer.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString("utf8"),
                });
            });
        });
        sent.on("error", reject);
        sent.end(body);
    });
}

describe("requests to a server of the run", () => {
    test("a request to the port a server listens on reaches it, with its method, path and body, and brings back its answer", async () => {
        await runInRun(async () => {
            const server = await startEchoServer(8976);
            const answer = await sendAndRead("http://127.0.0.1:8976/callback?code=abc", "POST", "sent");
            assert.equal(answer.status, 200);
            assert.deepEqual(JSON.parse(answer.body), {
                method: "POST",
                path: "/callback?code=abc",
                body: "sent",
                host: "127.0.0.1:8976",
            });
            server.close();
        });
    });

    test("a request asked for over HTTPS to a server of the run is carried to it all the same", async () => {
        await runInRun(async () => {
            const server = await startEchoServer(9443);
            const answer = await sendAndRead("https://localhost:9443/token", "GET", "");
            assert.equal(JSON.parse(answer.body).path, "/token");
            server.close();
        });
    });

    test("fetch reaches a server of the run too, and its answer reads as Node's fetch gives it", async () => {
        await runInRun(async (subject) => {
            const server = await startEchoServer(0);
            const port = server.address().port;
            assert.equal(port, firstGivenPort);
            const answer = await subject.network.fetch(`http://localhost:${port}/api`, {
                method: "PUT",
                body: "hello",
                headers: {
                    "x-asked": "yes",
                },
            });
            assert.equal(answer.status, 200);
            assert.equal(answer.headers.get("content-type"), "application/json");
            const read = await answer.json() as { method: string; body: string };
            assert.equal(read.method, "PUT");
            assert.equal(read.body, "hello");
            server.close();
        });
    });

    test("a request to another machine, or to a port no server of the run listens on, gets the simulated answer", async () => {
        await runInRun(async () => {
            const server = await startEchoServer(8000);
            const elsewhere = await sendAndRead("http://example.com:8000/", "GET", "");
            const unheard = await sendAndRead("http://127.0.0.1:8001/", "GET", "");
            assert.equal(elsewhere.body, "");
            assert.equal(unheard.body, "");
            server.close();
            const closed = await sendAndRead("http://127.0.0.1:8000/", "GET", "");
            assert.equal(closed.body, "");
        });
    });

    test("an answer with no body, such as a redirect with no content, is a response with no body", async () => {
        await runInRun(async (subject) => {
            const server = http.createServer((_request: realHttp.IncomingMessage, response: realHttp.ServerResponse) => {
                response.statusCode = 204;
                response.end();
            });
            await new Promise<void>((done) => {
                server.listen(7000, () => done());
            });
            const answer = await subject.network.fetch("http://127.0.0.1:7000/", undefined);
            assert.equal(answer.status, 204);
            assert.equal(await answer.text(), "");
            server.close();
        });
    });
});

describe("a request given as an object of options", () => {
    test("reaches a server of the run with the path and method the options name", async () => {
        await runInRun(async () => {
            const server = await startEchoServer(8100);
            const answer = await new Promise<string>((resolve, reject) => {
                const sent = http.request({
                    hostname: "127.0.0.1",
                    port: 8100,
                    path: "/from-options",
                    method: "DELETE",
                }, (read: realHttp.IncomingMessage) => {
                    const chunks: Buffer[] = [];
                    read.on("data", (chunk: Buffer) => {
                        chunks.push(chunk);
                    });
                    read.on("end", () => {
                        resolve(Buffer.concat(chunks).toString("utf8"));
                    });
                });
                sent.on("error", reject);
                sent.end();
            });
            assert.equal(JSON.parse(answer).path, "/from-options");
            assert.equal(JSON.parse(answer).method, "DELETE");
            server.close();
        });
    });
});

describe("what a server of the run is asked and answers", () => {
    test("a second request to the same server reaches it on a connection of its own", async () => {
        await runInRun(async () => {
            const server = await startEchoServer(8200);
            const first = await sendAndRead("http://127.0.0.1:8200/one", "GET", "");
            const second = await sendAndRead("http://127.0.0.1:8200/two", "GET", "");
            assert.equal(JSON.parse(first.body).path, "/one");
            assert.equal(JSON.parse(second.body).path, "/two");
            server.close();
        });
    });

    test("fetch given a Request sends it as it is, and a header sent more than once comes back joined", async () => {
        await runInRun(async (subject) => {
            const server = http.createServer((request: realHttp.IncomingMessage, response: realHttp.ServerResponse) => {
                response.setHeader("set-cookie", ["a=1", "b=2"]);
                response.end(request.method);
            });
            await new Promise<void>((done) => {
                server.listen("8300", () => done());
            });
            const answer = await subject.network.fetch(new Request("http://127.0.0.1:8300/", {
                method: "PATCH",
            }), undefined);
            assert.equal(await answer.text(), "PATCH");
            assert.equal(answer.headers.get("set-cookie"), "a=1, b=2");
            server.close();
        });
    });

    test("a server made outside a run says it is listening and listens on no port", async () => {
        const server = http.createServer();
        await new Promise<void>((done) => {
            server.listen(1234, () => done());
        });
        assert.equal(server.listening, true);
        assert.equal(server.address().port, 0);
        server.close();
        assert.equal(server.listening, false);
    });
});

describe("loopbackPair", () => {
    test("each end takes the socket calls Node's HTTP code makes and gives itself back, and says where it is", () => {
        const [client, server] = loopbackPair(8976, () => undefined);
        for (const end of [client, server]) {
            const calls = end as unknown as Record<string, () => unknown>;
            for (const name of ["setNoDelay", "setKeepAlive", "ref", "unref"]) {
                assert.equal(calls[name]!(), end);
            }
            assert.equal(end.setTimeout(0, undefined), end);
            assert.equal(Reflect.get(end, "remoteAddress"), "127.0.0.1");
            assert.equal(Reflect.get(end, "remotePort"), 8976);
        }
        client.destroy();
        server.destroy();
    });

    test("every write and every end on either side is counted as activity, and the bytes still go across", async () => {
        let activity = 0;
        const [client, server] = loopbackPair(8976, () => {
            activity += 1;
        });
        const read: string[] = [];
        server.on("data", (chunk: Buffer) => {
            read.push(chunk.toString("utf8"));
        });
        client.write("one");
        client.end("two");
        server.end();
        await new Promise<void>((done) => {
            server.on("end", () => done());
        });
        assert.equal(activity, 3);
        assert.deepEqual(read.join(""), "onetwo");
    });
});

//
// The idle timeout is checked on Jest's fake clock, so no test waits on real time: an end given a
// timeout emits `timeout` once the pair has carried nothing for that long, a write on either end
// starts the wait again, and zero or a closed end waits for nothing.
//
describe("the idle timeout of a loopback pair", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test("an end given a timeout emits timeout, and calls the callback given with it, once the pair has been idle that long", () => {
        const [client, server] = loopbackPair(8976, () => undefined);
        const seen: string[] = [];
        client.on("timeout", () => {
            seen.push("event");
        });
        client.setTimeout(100, () => {
            seen.push("callback");
        });
        jest.advanceTimersByTime(99);
        assert.deepEqual(seen, []);
        jest.advanceTimersByTime(1);
        assert.deepEqual(seen, ["event", "callback"]);
        client.destroy();
        server.destroy();
    });

    test("a write on either end starts the wait again", () => {
        const [client, server] = loopbackPair(8976, () => undefined);
        let timedOut = 0;
        client.on("timeout", () => {
            timedOut += 1;
        });
        client.setTimeout(100, undefined);
        jest.advanceTimersByTime(60);
        server.write("answer");
        jest.advanceTimersByTime(60);
        client.write("more");
        jest.advanceTimersByTime(60);
        assert.equal(timedOut, 0);
        jest.advanceTimersByTime(40);
        assert.equal(timedOut, 1);
        client.destroy();
        server.destroy();
    });

    test("a timeout of zero, or an end that has closed, waits for nothing", () => {
        const [client, server] = loopbackPair(8976, () => undefined);
        let timedOut = 0;
        client.on("timeout", () => {
            timedOut += 1;
        });
        server.on("timeout", () => {
            timedOut += 1;
        });
        client.setTimeout(100, undefined);
        client.setTimeout(0, undefined);
        server.setTimeout(100, undefined);
        server.destroy();
        jest.runOnlyPendingTimers();
        client.write("after");
        jest.advanceTimersByTime(1000);
        assert.equal(timedOut, 0);
        client.destroy();
    });

    test("a request's timeout is set on the client's end when Node's HTTP code connects, and a request with none sets nothing", () => {
        const [client, server] = loopbackPair(8976, () => undefined);
        let timedOut = 0;
        client.on("timeout", () => {
            timedOut += 1;
        });
        assert.equal(connectLoopback(client, {}), client);
        jest.advanceTimersByTime(10_000);
        assert.equal(timedOut, 0);
        assert.equal(connectLoopback(client, { timeout: 100 }), client);
        jest.advanceTimersByTime(100);
        assert.equal(timedOut, 1);
        client.destroy();
        server.destroy();
    });

    test("a timeout that is not a number of milliseconds at or above zero is a programmer error", () => {
        const timeout = new IdleTimeout(loopbackPair(8976, () => undefined)[0]);
        assert.throws(() => timeout.set(-1, undefined), /less than zero/);
        assert.throws(() => timeout.set(Number.NaN, undefined), /not a number of milliseconds/);
    });
});

describe("aimOf", () => {
    test("a request's host and port are read from a URL, a URL's text or an object of options", () => {
        assert.deepEqual(aimOf("http://127.0.0.1:8976/a", undefined), { hostname: "127.0.0.1", port: 8976 });
        assert.deepEqual(aimOf(new URL("https://example.com/"), undefined), { hostname: "example.com", port: 443 });
        assert.deepEqual(aimOf({ hostname: "localhost", port: 3000 }, undefined), { hostname: "localhost", port: 3000 });
        assert.deepEqual(aimOf({ host: "localhost:3000" }, { port: "3001" }), { hostname: "localhost", port: 3001 });
        assert.deepEqual(aimOf({ protocol: "http:" }, undefined), { hostname: "localhost", port: 80 });
        assert.deepEqual(aimOf("not a url", undefined), { hostname: "not a url", port: 80 });
    });
});

describe("isLoopback and portOf", () => {
    test("only the names of this machine are loopback, and a URL's port is the one it names or its scheme's", () => {
        assert.equal(isLoopback("localhost"), true);
        assert.equal(isLoopback("127.0.0.1"), true);
        assert.equal(isLoopback("[::1]"), true);
        assert.equal(isLoopback("example.com"), false);
        assert.equal(portOf(new URL("http://a/")), 80);
        assert.equal(portOf(new URL("https://a/")), 443);
        assert.equal(portOf(new URL("http://a:8080/")), 8080);
    });
});

describe("a failure injected at a request to a server of the run", () => {
    test("fails the request the way the injector says, and the server never hears it", async () => {
        const subject = new RunSubject(1, {
            place: {
                effect: "network",
                occurrence: 1,
            },
            failure: "connection-refused",
        });
        const before = runWith(subject);
        try {
            let heard = 0;
            const server = http.createServer((_request: realHttp.IncomingMessage, response: realHttp.ServerResponse) => {
                heard += 1;
                response.end("heard");
            });
            await new Promise<void>((done) => {
                server.listen(8400, () => done());
            });
            const refused = await new Promise<unknown>((resolve) => {
                const sent = http.request("http://127.0.0.1:8400/", resolve);
                sent.on("error", resolve);
                sent.end();
            });
            assert.ok(refused instanceof Error);
            assert.equal(Reflect.get(refused, "code"), "ECONNREFUSED");
            assert.equal(heard, 0);
            server.close();
        }
        finally {
            runWith(before);
        }
    });

    test("fails a fetch to it the same way", async () => {
        const subject = new RunSubject(1, {
            place: {
                effect: "network",
                occurrence: 1,
            },
            failure: "connection-refused",
        });
        const before = runWith(subject);
        try {
            const server = await startEchoServer(8500);
            await assert.rejects(subject.network.fetch("http://127.0.0.1:8500/", undefined), /fetch failed/);
            server.close();
        }
        finally {
            runWith(before);
        }
    });
});

describe("a server of the run that fails part way through", () => {
    test("a body cut off after its headers fails the reading of it, not the fetch, and the exchange ends", async () => {
        await runInRun(async (subject) => {
            const server = http.createServer((_request: realHttp.IncomingMessage, response: realHttp.ServerResponse) => {
                response.writeHead(500, {
                    "content-length": "100",
                });
                response.write("part of it");
                setImmediate(() => {
                    response.socket?.destroy();
                });
            });
            await new Promise<void>((done) => {
                server.listen(8600, () => done());
            });
            const answer = await subject.network.fetch("http://127.0.0.1:8600/", undefined);
            assert.equal(answer.status, 500);
            await assert.rejects(answer.text(), /terminated/);
            await new Promise<void>((done) => {
                setImmediate(done);
            });
            assert.equal(subject.network.isExchanging(), false);
            server.close();
        });
    });

    test("a connection dropped before any answer fails the fetch, and the exchange ends", async () => {
        await runInRun(async (subject) => {
            const server = http.createServer((request: realHttp.IncomingMessage) => {
                request.socket.destroy();
            });
            await new Promise<void>((done) => {
                server.listen(8700, () => done());
            });
            await assert.rejects(subject.network.fetch("http://127.0.0.1:8700/", undefined));
            assert.equal(subject.network.isExchanging(), false);
            server.close();
        });
    });
});

describe("closing a server", () => {
    test("a server that is not listening closes with Node's error and still says it closed", async () => {
        await runInRun(async () => {
            const server = http.createServer();
            let closed = false;
            server.on("close", () => {
                closed = true;
            });
            const error = await new Promise<Error | undefined>((resolve) => {
                server.close(resolve);
            });
            assert.ok(error instanceof Error);
            assert.equal(Reflect.get(error, "code"), "ERR_SERVER_NOT_RUNNING");
            assert.equal(closed, true);
        });
    });

    test("a server that is listening closes with no error", async () => {
        await runInRun(async () => {
            const server = await startEchoServer(8800);
            const error = await new Promise<Error | undefined>((resolve) => {
                server.close(resolve);
            });
            assert.equal(error, undefined);
        });
    });
});
