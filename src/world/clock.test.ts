// Checks the simulated clock and its timers.
//
// Readings are taken with no failure planned and with each clock failure planned at the second
// reading, so each is compared with the reading before it. Timers are set in an order that is not
// the order they are due, then run one at a time, to show they run in the order they are due, that
// clearing one stops it and that a repeating one runs again.

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { clockStartMs, RunClock, timerDelay } from "./clock.ts";
import { Injector } from "./injector.ts";

// A clock that fails the reading at `occurrence` the way `failure` says, or none when no failure is
// given.
function clockFailing(failure: string | undefined, occurrence: number): RunClock {
    const planned = failure === undefined ? undefined : {
        place: {
            effect: "clock" as const,
            occurrence,
        },
        failure,
    };
    return new RunClock(new Injector(planned));
}

describe("readings", () => {
    test("the wall clock starts at the fixed start and moves on a millisecond per reading", () => {
        const clock = clockFailing(undefined, 0);
        assert.equal(clock.now(), clockStartMs);
        assert.equal(clock.now(), clockStartMs + 1);
    });

    test("the clock that never goes back starts at zero and moves on a millisecond per reading", () => {
        const clock = clockFailing(undefined, 0);
        assert.equal(clock.monotonic(), 0);
        assert.equal(clock.monotonic(), 1);
    });

    test("every reading is a place where each clock failure can happen", () => {
        const injector = new Injector(undefined);
        const clock = new RunClock(injector);
        clock.now();
        clock.monotonic();
        assert.deepEqual(injector.reached, [
            { place: { effect: "clock", occurrence: 0 }, failures: ["time-goes-backwards", "time-stands-still", "time-jumps-far-forward"] },
            { place: { effect: "clock", occurrence: 1 }, failures: ["time-goes-backwards", "time-stands-still", "time-jumps-far-forward"] },
        ]);
    });

    for (const read of ["now", "monotonic"] as const) {
        test(`time that goes backwards reads earlier than the reading before, through ${read}`, () => {
            const clock = clockFailing("time-goes-backwards", 1);
            const first = clock[read]();
            assert.ok(clock[read]() < first);
        });

        test(`time that stands still reads what the reading before read, through ${read}`, () => {
            const clock = clockFailing("time-stands-still", 1);
            const first = clock[read]();
            assert.equal(clock[read](), first);
        });

        test(`time that jumps reads far past the reading before, through ${read}`, () => {
            const clock = clockFailing("time-jumps-far-forward", 1);
            const first = clock[read]();
            const second = clock[read]();
            assert.ok(second - first >= 3600000);
            assert.ok(clock[read]() > second);
        });
    }

    test("a stamp reads the clock without moving it or asking the injector", () => {
        const injector = new Injector(undefined);
        const clock = new RunClock(injector);
        assert.equal(clock.stampMs(), clockStartMs);
        assert.equal(clock.stampMs(), clockStartMs);
        assert.equal(clock.startedAtMs(), clockStartMs);
        assert.deepEqual(injector.reached, []);
    });

    test("moving the clock forward moves both clocks, and moving it back moves neither", () => {
        const clock = clockFailing(undefined, 0);
        clock.advance(500);
        clock.advance(-100);
        assert.equal(clock.stampMs(), clockStartMs + 500);
        assert.equal(clock.monotonic(), 500);
    });
});

describe("timers", () => {
    test("timers run in the order they are due, and those due together in the order they were set", () => {
        const clock = clockFailing(undefined, 0);
        const ran: string[] = [];
        clock.setTimer(300, () => ran.push("late"), false);
        clock.setTimer(100, () => ran.push("first of two"), false);
        clock.setTimer(100, () => ran.push("second of two"), false);
        clock.setTimer(0, () => ran.push("at once"), false);
        while (clock.runNextTimer()) {
            // Each turn runs one timer.
        }
        assert.deepEqual(ran, ["at once", "first of two", "second of two", "late"]);
    });

    test("running a timer moves the clock on to when it was due", () => {
        const clock = clockFailing(undefined, 0);
        clock.setTimer(5000, () => undefined, false);
        clock.runNextTimer();
        assert.equal(clock.stampMs(), clockStartMs + 5000);
    });

    test("a cleared timer never runs, and clearing one that is not there changes nothing", () => {
        const clock = clockFailing(undefined, 0);
        const ran: string[] = [];
        const cleared = clock.setTimer(10, () => ran.push("cleared"), false);
        clock.setTimer(20, () => ran.push("kept"), false);
        clock.clearTimer(cleared);
        clock.clearTimer(999);
        while (clock.runNextTimer()) {
            // Each turn runs one timer.
        }
        assert.deepEqual(ran, ["kept"]);
        assert.equal(clock.hasTimers(), false);
    });

    test("a repeating timer runs every time its delay passes until it is cleared", () => {
        const clock = clockFailing(undefined, 0);
        const times: number[] = [];
        const id = clock.setTimer(1000, () => {
            times.push(clock.stampMs() - clockStartMs);
            if (times.length === 3) {
                clock.clearTimer(id);
            }
        }, true);
        while (clock.runNextTimer()) {
            // Each turn runs one timer.
        }
        assert.deepEqual(times, [1000, 2000, 3000]);
    });

    test("a repeating timer whose repeats are ended runs once more and is gone, and a timer set after still repeats", () => {
        const clock = clockFailing(undefined, 0);
        const ran: string[] = [];
        clock.setTimer(10, () => ran.push("ended"), true);
        clock.endRepeats();
        clock.runNextTimer();
        assert.deepEqual(ran, ["ended"]);
        assert.equal(clock.hasTimers(), false);
        clock.setTimer(10, () => ran.push("later"), true);
        clock.runNextTimer();
        clock.runNextTimer();
        assert.deepEqual(ran, ["ended", "later", "later"]);
        assert.equal(clock.hasTimers(), true);
    });

    test("with no timer waiting there is none to run", () => {
        const clock = clockFailing(undefined, 0);
        assert.equal(clock.hasTimers(), false);
        assert.equal(clock.runNextTimer(), false);
        assert.equal(clock.nextDueInMs(), undefined);
    });

    test("the time until the timer due first counts down as the clock moves on", () => {
        const clock = clockFailing(undefined, 0);
        clock.setTimer(50, () => undefined, false);
        clock.setTimer(20, () => undefined, false);
        clock.setTimer(30, () => undefined, false);
        assert.equal(clock.nextDueInMs(), 20);
        clock.advance(5);
        assert.equal(clock.nextDueInMs(), 15);
        clock.advance(100);
        assert.equal(clock.nextDueInMs(), 0);
    });

    test("a timer's ids start at one", () => {
        assert.equal(clockFailing(undefined, 0).setTimer(1, () => undefined, false), 1);
    });

    test("a delay Node would not wait for waits one millisecond, as Node's does", () => {
        assert.equal(timerDelay(0), 1);
        assert.equal(timerDelay(-5), 1);
        assert.equal(timerDelay(Number.NaN), 1);
        assert.equal(timerDelay("ten"), 1);
        assert.equal(timerDelay(2147483648), 1);
        assert.equal(timerDelay(250.7), 250);
        assert.equal(timerDelay("40"), 40);
    });
});
