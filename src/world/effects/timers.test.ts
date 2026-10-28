// Tests for the replacement of `node:timers`.
//
// The goal is to show that a timer set through the module waits on the run's clock as one set
// through the global does and that with no run in flight the timers are handed to the real module.
// The real module's timers are replaced here by stand-ins that set nothing, so the test checks each
// is handed on with the same arguments and its answer handed back. No test waits on the wall clock.
// The method is to set timers with a run in flight and run them one at a time on the run's clock,
// then set them with no run in flight and read back what the stand-ins were called with.

import assert from "node:assert/strict";
import type * as timersModule from "node:timers";
import { describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import { RunTimer } from "../globals.ts";
import { RunSubject } from "../subject.ts";
import timers, { clearInterval, clearTimeout, setInterval, setTimeout } from "./timers.ts";

// The real module with its timers replaced by stand-ins that set nothing and answer with a value
// naming themselves.
jest.mock("node:timers", () => ({
    ...jest.requireActual<typeof timersModule>("node:timers"),
    setTimeout: jest.fn(() => "real setTimeout"),
    setInterval: jest.fn(() => "real setInterval"),
    clearTimeout: jest.fn(),
    clearInterval: jest.fn(),
}));

// The stand-ins above, as the test reads them back.
const realModule = jest.requireMock<Record<string, jest.Mock>>("node:timers");

// The arguments the stand-in `name` was last called with, copied out of the mock's own realm.
export function lastCall(name: string): unknown[] {
    return Array.from(realModule[name].mock.lastCall ?? []);
}

// A timer's work, which nothing runs while the real module is stood in for.
export function ignoreTimer(): void {
    return undefined;
}

describe("with a run in flight", () => {
    test("a timer set through the module waits on the run's clock, in order of its delay", () => {
        const subject = new RunSubject(1, undefined);
        const before = runWith(subject);
        const ran: string[] = [];
        try {
            assert.ok(setTimeout(() => ran.push("later"), 50) instanceof RunTimer);
            setTimeout((word: string) => ran.push(word), 5, "sooner");
            clearTimeout(setTimeout(() => ran.push("cleared"), 1));
            const interval = setInterval(() => {
                ran.push("interval");
                clearInterval(interval);
            }, 20);
            // A bound on the turns, so a timer that keeps setting itself again fails the test rather
            // than hanging it.
            for (let turn = 0; turn < 10; turn += 1) {
                if (!subject.clock.runNextTimer()) {
                    break;
                }
            }
        }
        finally {
            runWith(before);
        }
        assert.deepEqual(ran, ["sooner", "interval", "later"]);
    });
});

describe("with no run in flight", () => {
    test("each timer is handed to the real module with its arguments and its answer comes back", () => {
        assert.equal(setTimeout(ignoreTimer, 1000, "a"), "real setTimeout");
        assert.deepEqual(lastCall("setTimeout"), [ignoreTimer, 1000, "a"]);
        assert.equal(setInterval(ignoreTimer, 2000, "b"), "real setInterval");
        assert.deepEqual(lastCall("setInterval"), [ignoreTimer, 2000, "b"]);
        clearTimeout("real setTimeout");
        assert.deepEqual(lastCall("clearTimeout"), ["real setTimeout"]);
        clearInterval("real setInterval");
        assert.deepEqual(lastCall("clearInterval"), ["real setInterval"]);
        assert.equal(timers.setImmediate, globalThis.setImmediate);
    });
});
