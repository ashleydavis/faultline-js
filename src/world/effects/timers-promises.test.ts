// Tests for the replacement of `node:timers/promises`.
//
// The goal is to show that a wait set while a run is in flight is over as soon as the run's clock
// is moved on to it, that a wait given an aborted signal fails as Node's fails and that with no run
// in flight the waits are handed to the real module. The real module's waits are replaced here by
// stand-ins that wait for no time, so the test checks each is handed on with the same arguments and
// its answer handed back. No test waits on the wall clock. The method is to put a run in flight,
// set a wait and move the run's clock on one timer at a time until the wait is over.

import assert from "node:assert/strict";
import type * as timersPromisesModule from "node:timers/promises";
import { describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import { RunSubject } from "../subject.ts";
import timers, { scheduler, setImmediate, setInterval, setTimeout } from "./timers-promises.ts";

// The ticks the stand-in for the real `setInterval` hands over: one, then the interval ends. Its
// name starts with `mock` so the factory below may use it.
export async function* mockTicks(): AsyncGenerator<string> {
    yield "real tick";
}

// The real module with its waits replaced by stand-ins that wait for no time: `setTimeout` answers
// with a value naming itself, `setImmediate` with the value it was given (as the real one does) and
// `setInterval` with one tick.
jest.mock("node:timers/promises", () => ({
    ...jest.requireActual<typeof timersPromisesModule>("node:timers/promises"),
    setTimeout: jest.fn(async () => "real setTimeout"),
    setImmediate: jest.fn(async (value: unknown) => value),
    setInterval: jest.fn(() => mockTicks()),
}));

// The stand-ins above, as the test reads them back.
const realModule = jest.requireMock<Record<string, jest.Mock>>("node:timers/promises");

// The arguments the stand-in `name` was last called with, copied out of the mock's own realm.
export function lastCall(name: string): unknown[] {
    return Array.from(realModule[name].mock.lastCall ?? []);
}

// Runs `work` with one run in flight, running its timers whenever the work waits and waits for it.
export async function runInFlight<T>(work: () => Promise<T>): Promise<T> {
    const subject = new RunSubject(1, undefined);
    const before = runWith(subject);
    try {
        const settled = work();
        let done = false;
        settled.then(() => {
            done = true;
        }, () => {
            done = true;
        });
        // A bound on the turns, so a wait that never ends fails the test rather than hanging it.
        for (let turn = 0; turn < 100; turn += 1) {
            if (done) {
                break;
            }
            await new Promise((settle) => globalThis.setImmediate(settle));
            subject.clock.runNextTimer();
        }
        assert.ok(done, "The wait was not over after the run's clock had run every turn it is given.");
        return await settled;
    }
    finally {
        runWith(before);
    }
}

// What a wait that was aborted rejects with, as Node names it.
const abortError = {
    name: "AbortError",
};

describe("with a run in flight", () => {
    test("a wait is over once the run's clock reaches it and hands back its value", async () => {
        assert.equal(await runInFlight(() => setTimeout(60000, "waited")), "waited");
        assert.equal(await runInFlight(() => scheduler.wait(1000)), undefined);
        assert.equal(await runInFlight(() => scheduler.yield()), undefined);
        assert.equal(await runInFlight(() => setImmediate("now")), "now");
        assert.deepEqual(lastCall("setImmediate"), ["now", undefined]);
    });

    test("an interval hands over its value every time the clock reaches it", async () => {
        const ticks = await runInFlight(async () => {
            const seen: string[] = [];
            for await (const tick of setInterval(100, "tick")) {
                seen.push(tick);
                if (seen.length === 3) {
                    break;
                }
            }
            return seen;
        });
        assert.deepEqual(ticks, ["tick", "tick", "tick"]);
    });

    test("a wait given a signal that is or becomes aborted fails with an AbortError", async () => {
        const aborted = new AbortController();
        aborted.abort();
        await assert.rejects(runInFlight(() => setTimeout(10, "x", {
            signal: aborted.signal,
        })), abortError);
        const later = new AbortController();
        await assert.rejects(runInFlight(() => {
            const waiting = setTimeout(1000, "x", {
                signal: later.signal,
            });
            later.abort();
            return waiting;
        }), abortError);
    });
});

describe("with no run in flight", () => {
    test("each wait is handed to the real module with its arguments and its answer comes back", async () => {
        const options = {
            ref: false,
        };
        assert.equal(await setTimeout(1, "value", options), "real setTimeout");
        assert.deepEqual(lastCall("setTimeout"), [1, "value", options]);
        const ticks: string[] = [];
        for await (const tick of setInterval(2, "value", options)) {
            ticks.push(tick);
        }
        assert.deepEqual(ticks, ["real tick"]);
        assert.deepEqual(lastCall("setInterval"), [2, "value", options]);
        assert.equal(timers.setTimeout, setTimeout);
    });
});
