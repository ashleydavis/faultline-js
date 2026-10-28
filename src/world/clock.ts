// The simulated clock and the timers that run in its time.
//
// Time moves only when this clock moves it, so a call that waits an hour costs the run no time at
// all and reads the same times on every machine. Each reading moves the clock on by one
// millisecond, the way a real clock has moved on by the next time it is read, so a reading that
// stands still is a failure the injector chooses rather than what every reading does.

import assert from "node:assert/strict";
import type { Injector } from "./injector.ts";
import { failureIdsOf } from "./failures.ts";

// What the clock reads when a run starts: the first second of 2024, in milliseconds since the
// epoch. It is fixed rather than read from the machine, so two runs read the same times.
export const clockStartMs = 1704067200000;

// How far a reading that goes backwards is behind the reading before it. A second crosses any
// comparison the code under test makes without leaving the same day.
const backwardsMs = 1000;

// How far a reading that jumps forward is past the reading before it. An hour expires anything the
// code under test holds a deadline for.
const jumpMs = 3600000;

// The largest delay Node takes for a timer, two to the thirty first less one. Node runs a timer
// given more than this, less than one or a delay that is not a number after one millisecond.
const longestDelayMs = 2147483647;

// One timer waiting to run.
interface Timer {
    // What the timer was handed back as, so clearing it finds it.
    id: number;

    // When it is due, in milliseconds of the clock's elapsed time.
    dueMs: number;

    // What it runs.
    work: () => void;

    // How long it waits between turns, for a timer that repeats.
    repeatMs: number | undefined;
}

// A clock a run owns, with the timers set while the run was in flight.
export class RunClock {
    // Milliseconds since the epoch, as this clock currently reads.
    private wallMs: number;

    // Milliseconds since this clock was built, which the clock moves forward and never back.
    private elapsedMs = 0;

    // The last reading of the wall clock that was handed out, which a reading that stands still or
    // goes backwards is measured from.
    private lastWallMs: number;

    // The last reading of the elapsed clock that was handed out.
    private lastElapsedMs = 0;

    // Every timer waiting to run, in the order it was set.
    private readonly timers: Timer[] = [];

    // The id the next timer is handed back as. Ids start at one, as Node's do, so an id is never
    // read as false.
    private nextTimerId = 1;

    // What decides which readings go wrong.
    private readonly injector: Injector;

    constructor(injector: Injector) {
        this.injector = injector;
        this.wallMs = clockStartMs;
        this.lastWallMs = clockStartMs;
    }

    // What the wall clock reads, as `Date.now` reads it.
    now(): number {
        const failure = this.injector.check("clock", failureIdsOf("clock"));
        this.lastWallMs = this.reading(failure, this.wallMs, this.lastWallMs);
        this.wallMs = Math.max(this.wallMs, this.lastWallMs) + 1;
        return this.lastWallMs;
    }

    // What the clock that never goes back reads, as `performance.now` reads it.
    monotonic(): number {
        const failure = this.injector.check("clock", failureIdsOf("clock"));
        this.lastElapsedMs = this.reading(failure, this.elapsedMs, this.lastElapsedMs);
        this.elapsedMs = Math.max(this.elapsedMs, this.lastElapsedMs) + 1;
        return this.lastElapsedMs;
    }

    // What the wall clock reads, without asking the injector and without moving it on. The
    // simulated world stamps the times a file was written with this, because a stamp is not a
    // reading the code under test made and so is not a place.
    stampMs(): number {
        return this.wallMs;
    }

    // What the wall clock read when the run started.
    startedAtMs(): number {
        return clockStartMs;
    }

    // One reading, given the failure the injector chose, what the clock reads and the reading
    // handed out before.
    private reading(failure: string | undefined, currentMs: number, lastMs: number): number {
        if (failure === "time-goes-backwards") {
            return lastMs - backwardsMs;
        }
        if (failure === "time-stands-still") {
            return lastMs;
        }
        if (failure === "time-jumps-far-forward") {
            return currentMs + jumpMs;
        }
        return currentMs;
    }

    // Sets a timer that runs `work` once `delayMs` has passed, or every `delayMs` when it repeats,
    // and hands back its id.
    setTimer(delayMs: unknown, work: () => void, repeats: boolean): number {
        const waitMs = timerDelay(delayMs);
        const id = this.nextTimerId;
        this.nextTimerId += 1;
        this.timers.push({
            id,
            dueMs: this.elapsedMs + waitMs,
            work,
            repeatMs: repeats ? waitMs : undefined,
        });
        return id;
    }

    // Takes a timer away before it runs. A timer that already ran, or an id no timer has, is left
    // alone, as Node leaves it.
    clearTimer(id: number): void {
        const at = this.timers.findIndex((timer) => timer.id === id);
        if (at >= 0) {
            this.timers.splice(at, 1);
        }
    }

    // Makes every timer waiting to run a timer that runs once, so none is set again after it runs.
    // The run loop does it once a call has settled: a repeating timer the call left behind runs one
    // more time, which exercises its work, and does not run on for as long as the call's timers
    // are run after it settled. Run on, an interval of a millisecond ran sixty thousand times after
    // each call, every run a new place where a failure was then injected.
    endRepeats(): void {
        for (const timer of this.timers) {
            timer.repeatMs = undefined;
        }
        assert(this.timers.every((timer) => timer.repeatMs === undefined));
    }

    // Whether any timer is waiting to run.
    hasTimers(): boolean {
        return this.timers.length > 0;
    }

    // How long from now until the timer due first, or undefined when no timer is waiting. The run
    // loop reads it to stop running the timers a call left behind once they are due too far ahead.
    nextDueInMs(): number | undefined {
        if (this.timers.length === 0) {
            return undefined;
        }
        let firstMs = this.timers[0]!.dueMs;
        for (const timer of this.timers) {
            firstMs = Math.min(firstMs, timer.dueMs);
        }
        return Math.max(0, firstMs - this.elapsedMs);
    }

    // Runs the timer due first, moving the clock forward to when it is due, and says whether there
    // was one. Timers due at the same time run in the order they were set. A timer that repeats is
    // set again before it runs, so clearing itself from inside its work stops it.
    runNextTimer(): boolean {
        if (this.timers.length === 0) {
            return false;
        }
        let first = 0;
        for (let index = 1; index < this.timers.length; index += 1) {
            if (this.timers[index]!.dueMs < this.timers[first]!.dueMs) {
                first = index;
            }
        }
        const timer = this.timers.splice(first, 1)[0]!;
        this.advance(timer.dueMs - this.elapsedMs);
        if (timer.repeatMs !== undefined) {
            this.timers.push({
                ...timer,
                dueMs: this.elapsedMs + timer.repeatMs,
            });
        }
        timer.work();
        return true;
    }

    // Moves this clock forward. Running a timer does it, and so does a run between calls.
    advance(milliseconds: number): void {
        const forwardMs = Math.max(0, Math.floor(milliseconds));
        this.wallMs += forwardMs;
        this.elapsedMs += forwardMs;
    }
}

// The delay a timer waits, as Node works it out from what it was given.
export function timerDelay(delayMs: unknown): number {
    const asked = Number(delayMs);
    if (!(asked >= 1 && asked <= longestDelayMs)) {
        return 1;
    }
    return Math.floor(asked);
}
