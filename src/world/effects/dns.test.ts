// Tests for the replacement of `node:dns`.
//
// The goal is to show that a lookup reaches no name server: it resolves to the loopback address
// with no failure planned. It fails as `docs/FAILURES.md` says with each failure planned at its
// place, in the callback and promise forms alike. With no run in flight every call goes to the real
// module, which is replaced here by stand-ins, so the test checks each call is handed on with the
// same arguments and its answer handed back. No name server is ever asked. The method is to put a
// run in flight, look a name up through every form and read back the answer or the error.

import assert from "node:assert/strict";
import realDns from "node:dns";
import { promisify } from "node:util";
import { describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import type { PlannedFailure } from "../injector.ts";
import { lookupFailures } from "../network.ts";
import { RunSubject } from "../subject.ts";
import dns, { lookup, resolve, resolve4, resolve6 } from "./dns.ts";

// The stand-ins as the test reads them back: each call by name, with the promise half's.
export interface IMockedDnsModule {
    // The promise half's stand-ins.
    promises: Record<string, jest.Mock>;

    // Every other stand-in, by name.
    [name: string]: jest.Mock | Record<string, jest.Mock>;
}

// A stand-in for a callback form that asks no name server and calls back at once with `answer`.
// Its name starts with `mock` so the factory below may use it.
export function mockAnswering(answer: string | string[]): jest.Mock {
    return jest.fn((...args: unknown[]) => {
        const done = args[args.length - 1];
        if (typeof done === "function") {
            done(null, answer);
        }
    });
}

// The real module with every lookup and resolve replaced by a stand-in that asks no name server:
// the callback forms call back with an answer of their own and the promise forms resolve to one.
jest.mock("node:dns", () => {
    const actual = jest.requireActual<typeof realDns>("node:dns");
    return {
        ...actual,
        lookup: mockAnswering("10.0.0.1"),
        resolve4: mockAnswering(["10.0.0.4"]),
        resolve6: mockAnswering(["fd00::6"]),
        promises: {
            ...actual.promises,
            lookup: jest.fn(async () => ({
                address: "10.0.0.2",
                family: 4,
            })),
            resolve4: jest.fn(async () => ["10.0.0.5"]),
            resolve6: jest.fn(async () => ["fd00::7"]),
        },
    };
});

// The stand-ins above, as the test reads them back.
const realModule = jest.requireMock<IMockedDnsModule>("node:dns");

// The arguments a stand-in was last called with, copied out of the mock's own realm.
export function lastCall(standInMock: jest.Mock): unknown[] {
    return Array.from(standInMock.mock.lastCall ?? []);
}

// The stand-in of the callback call `name`.
export function standIn(name: string): jest.Mock {
    const found = realModule[name];
    assert(typeof found === "function", `node:dns has no stand-in called ${name}.`);
    return found;
}

// The stand-in of the promise call `name`.
export function promiseStandIn(name: string): jest.Mock {
    const found = realModule.promises[name];
    assert(found, `node:dns has no promise stand-in called ${name}.`);
    return found;
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

// A callback form called as a promise of what it handed the callback. Each form has overloads of
// its own, so it is called through `Reflect.apply` rather than through one function type.
export function callAsPromise(call: Function, ...args: unknown[]): Promise<unknown[]> {
    return new Promise((settle) => {
        Reflect.apply(call, undefined, [...args, (...answer: unknown[]) => settle(answer)]);
    });
}

// The field `name` of an error a lookup failed with.
export function errorField(error: unknown, name: string): unknown {
    assert.ok(error instanceof Error);
    return Reflect.get(error, name);
}

// The loopback address as a lookup with `all` answers it.
const loopbackAddress = {
    address: "127.0.0.1",
    family: 4,
};

describe("lookups that work", () => {
    test("every callback lookup resolves to the loopback address", async () => {
        await runWithNoFailure(async (subject) => {
            assert.deepEqual(await callAsPromise(lookup, "example.com"), [null, "127.0.0.1", 4]);
            assert.deepEqual(await callAsPromise(lookup, "example.com", {
                all: true,
            }), [null, [loopbackAddress]]);
            assert.deepEqual(await callAsPromise(resolve4, "example.com"), [null, ["127.0.0.1"]]);
            assert.deepEqual(await callAsPromise(resolve6, "example.com"), [null, ["::1"]]);
            assert.deepEqual(await callAsPromise(resolve, "example.com"), [null, ["127.0.0.1"]]);
            assert.deepEqual(await callAsPromise(resolve, "example.com", "AAAA"), [null, ["::1"]]);
            assert.deepEqual(subject.injector.reached[0], {
                place: {
                    effect: "network",
                    occurrence: 0,
                },
                failures: lookupFailures,
            });
        });
    });

    test("every promise lookup resolves to the loopback address", async () => {
        await runWithNoFailure(async () => {
            assert.deepEqual(await dns.promises.lookup("example.com"), loopbackAddress);
            assert.deepEqual(await dns.promises.lookup("example.com", {
                all: true,
            }), [loopbackAddress]);
            assert.deepEqual(await dns.promises.resolve4("example.com"), ["127.0.0.1"]);
            assert.deepEqual(await dns.promises.resolve6("example.com"), ["::1"]);
            assert.deepEqual(await dns.promises.resolve("example.com"), ["127.0.0.1"]);
            assert.deepEqual(await dns.promises.resolve("example.com", "AAAA"), ["::1"]);
            assert.deepEqual(await promisify(lookup)("example.com"), loopbackAddress);
        });
    });
});

describe("lookups that fail", () => {
    // The code Node gives each failure a lookup can have.
    for (const [failure, code] of Object.entries({
        "name-does-not-resolve": "ENOTFOUND",
        "name-server-fails": "ESERVFAIL",
        "host-lookup-finds-no-address": "ENODATA",
    })) {
        test(`${failure} fails every form with ${code}`, async () => {
            const planned: PlannedFailure = {
                place: {
                    effect: "network",
                    occurrence: 0,
                },
                failure,
            };
            const [error] = await runInFlight(() => callAsPromise(lookup, "example.com", {}), planned);
            assert.equal(errorField(error, "code"), code);
            assert.equal(errorField(error, "hostname"), "example.com");
            const [resolved] = await runInFlight(() => callAsPromise(resolve4, "example.com"), planned);
            assert.equal(errorField(resolved, "code"), code);
            for (const call of [dns.promises.lookup, dns.promises.resolve4, dns.promises.resolve6]) {
                await runInFlight(() => assert.rejects(Reflect.apply(call, dns.promises, ["example.com"]), {
                    code,
                }), planned);
            }
        });
    }
});

describe("with no run in flight", () => {
    test("a lookup is handed to the real module with its arguments and its answer comes back", async () => {
        const options = {
            family: 4,
        };
        assert.deepEqual(await callAsPromise(lookup, "localhost", options), [null, "10.0.0.1"]);
        assert.deepEqual(lastCall(standIn("lookup")).slice(0, 2), ["localhost", options]);
        assert.deepEqual(await dns.promises.lookup("localhost", options), {
            address: "10.0.0.2",
            family: 4,
        });
        assert.deepEqual(lastCall(promiseStandIn("lookup")), ["localhost", options]);
    });

    test("a resolve is handed to the real module with its arguments and its answer comes back", async () => {
        assert.deepEqual(await callAsPromise(resolve4, "example.com"), [null, ["10.0.0.4"]]);
        assert.equal(lastCall(standIn("resolve4"))[0], "example.com");
        assert.deepEqual(await callAsPromise(resolve6, "example.com"), [null, ["fd00::6"]]);
        assert.equal(lastCall(standIn("resolve6"))[0], "example.com");
        assert.deepEqual(await dns.promises.resolve4("example.org"), ["10.0.0.5"]);
        assert.deepEqual(lastCall(promiseStandIn("resolve4")), ["example.org"]);
        assert.deepEqual(await dns.promises.resolve6("example.org"), ["fd00::7"]);
        assert.deepEqual(lastCall(promiseStandIn("resolve6")), ["example.org"]);
    });

    test("the default export keeps the real module's codes", () => {
        assert.equal(dns.NOTFOUND, realDns.NOTFOUND);
    });
});
