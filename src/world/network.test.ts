// Checks the simulated network: what `fetch` is answered with, and the answers and errors the
// network modules share.
//
// `fetch` is called with no failure planned and with each failure planned at its place, and what
// it answers or throws is read back.

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { Injector } from "./injector.ts";
import { connectError, connectFailures, hostOf, httpAnswer, isAborted, requestFailures, RunNetwork, syscallOf } from "./network.ts";

// A network whose first network call fails the way `failure` says, or none when no failure is
// given.
function networkFailing(failure: string | undefined): RunNetwork {
    return new RunNetwork(new Injector(failure === undefined ? undefined : {
        place: { effect: "network", occurrence: 0 },
        failure,
    }));
}

// The code on the cause of what `fetch` rejected with.
async function causeCode(answer: Promise<Response>): Promise<string | undefined> {
    try {
        await answer;
    }
    catch (thrown) {
        assert.ok(thrown instanceof TypeError);
        assert.equal(thrown.message, "fetch failed");
        return (thrown.cause as { code?: string }).code;
    }
    return undefined;
}

describe("fetch", () => {
    test("a request with no failure planned gets status 200 and an empty body", async () => {
        const answer = await networkFailing(undefined).fetch("https://example.com/items", undefined);
        assert.equal(answer.status, 200);
        assert.equal(await answer.text(), "");
    });

    test("a request is one place, where every failure a request can have can happen", async () => {
        const injector = new Injector(undefined);
        await new RunNetwork(injector).fetch(new URL("https://example.com/"), undefined);
        assert.deepEqual(injector.reached, [
            { place: { effect: "network", occurrence: 0 }, failures: requestFailures },
        ]);
    });

    const connectCodes: Record<string, string> = {
        "name-does-not-resolve": "ENOTFOUND",
        "connection-refused": "ECONNREFUSED",
        "connection-times-out": "ETIMEDOUT",
        "network-unreachable": "ENETUNREACH",
        "host-unreachable": "EHOSTUNREACH",
        "connection-aborted": "ECONNABORTED",
    };
    for (const [failure, code] of Object.entries(connectCodes)) {
        test(`${failure} rejects with a TypeError whose cause carries ${code}`, async () => {
            assert.equal(await causeCode(networkFailing(failure).fetch("https://example.com/", undefined)), code);
        });
    }

    test("a connection reset part way through answers, and reading the body fails with ECONNRESET", async () => {
        const answer = await networkFailing("connection-reset-part-way-through").fetch("https://example.com/", undefined);
        assert.equal(answer.status, 200);
        await assert.rejects(answer.text(), (thrown: TypeError) => (thrown.cause as { code: string }).code === "ECONNRESET");
    });

    test("a short response sends less than its content-length says", async () => {
        const answer = await networkFailing("short-response").fetch("https://example.com/", undefined);
        const body = await answer.text();
        assert.ok(body.length < Number(answer.headers.get("content-length")));
        assert.throws(() => JSON.parse(body));
    });

    test("a response that does not parse is sent as JSON and is not JSON", async () => {
        const answer = await networkFailing("response-that-does-not-parse").fetch("https://example.com/", undefined);
        assert.equal(answer.headers.get("content-type"), "application/json");
        await assert.rejects(answer.json());
    });

    test("a server error answers with status 500", async () => {
        const answer = await networkFailing("server-error").fetch(new Request("https://example.com/"), undefined);
        assert.equal(answer.status, 500);
        assert.equal(answer.ok, false);
    });

    test("a request given a signal can be aborted, and one already aborted is", async () => {
        const aborting = new RunNetwork(new Injector({
            place: { effect: "cancellation", occurrence: 0 },
            failure: "operation-aborted",
        }));
        await assert.rejects(aborting.fetch("https://example.com/", { signal: new AbortController().signal }), { name: "AbortError" });
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(networkFailing(undefined).fetch("https://example.com/", { signal: controller.signal }), { name: "AbortError" });
    });
});

describe("what the network modules share", () => {
    test("a lookup that fails is named getaddrinfo, a reset a read and the rest a connect", () => {
        assert.equal(syscallOf("name-does-not-resolve"), "getaddrinfo");
        assert.equal(syscallOf("connection-reset-part-way-through"), "read");
        assert.equal(syscallOf("connection-refused"), "connect");
        assert.equal(connectError("connection-refused", "example.com:80").message, "connect ECONNREFUSED example.com:80");
    });

    test("every connect failure stops a request before it is answered", () => {
        for (const failure of connectFailures) {
            const answer = httpAnswer(failure);
            if (failure === "connection-reset-part-way-through") {
                assert.equal(answer?.resetsAfterHeaders, true);
                continue;
            }
            assert.equal(answer, undefined, failure);
        }
    });

    test("the host of an address is read from its URL, and an address that is not a URL is its own host", () => {
        assert.equal(hostOf("https://example.com:8443/path"), "example.com:8443");
        assert.equal(hostOf("not a url"), "not a url");
    });

    test("a call given no signal is never aborted and is not a place", () => {
        const injector = new Injector(undefined);
        assert.equal(isAborted(injector, undefined), false);
        assert.deepEqual(injector.reached, []);
    });

    test("a call given a signal is a place where it can be aborted", () => {
        const injector = new Injector(undefined);
        assert.equal(isAborted(injector, new AbortController().signal), false);
        assert.deepEqual(injector.reached, [
            { place: { effect: "cancellation", occurrence: 0 }, failures: ["operation-aborted"] },
        ]);
    });
});
