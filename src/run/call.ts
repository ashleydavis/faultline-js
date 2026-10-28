//
// Makes one call with a run in flight and waits for it to settle and for simulated time to run out.
//
// Timers wait on the run's simulated clock and never run by themselves, so a call that waits an
// hour has its timers run here at once, in the order they are due. Between timers the event loop
// gets a turn, so the promises and callbacks the simulated world settles run as they would. A call
// that is still waiting when no timer is left and no real work is under way can never settle. A call
// that is still waiting when the wall-clock limit passes is taken not to.
//

import assert from "node:assert/strict";
import { nowRunning, runInContext, runWith, withoutRun } from "../world/current.ts";
import { realNow } from "../world/globals.ts";
import type { RunSubject } from "../world/subject.ts";
import { isError } from "./judge.ts";

//
// How long a call may take, in the child that makes it.
//
export interface ICallLimits {
    //
    // How long a call may wait on the wall clock before it is taken never to settle.
    //
    wallMs: number;

    //
    // How far past the moment a call settled the timers it left behind still run, in simulated
    // time. A timer due later is left, so an interval that never stops does not keep the run going.
    //
    afterSettleMs: number;
}

//
// Whether what the child was started with, read from JSON, is a set of limits. Every field is
// checked because a limit read wrongly would wait on every call for the wrong time.
//
export function isCallLimits(read: unknown): read is ICallLimits {
    if (typeof read !== "object") {
        return false;
    }
    if (read === null) {
        return false;
    }
    if (!("wallMs" in read)) {
        return false;
    }
    if (typeof read.wallMs !== "number") {
        return false;
    }
    if (!("afterSettleMs" in read)) {
        return false;
    }
    return typeof read.afterSettleMs === "number";
}

//
// The process's event loop as a call is waited on: the wall clock, a turn of the loop and the real
// work under way, which a call that is still waiting can be settled by. The child passes the real
// one and a test passes one whose clock and turns it moves itself, so no test waits on real time.
//
export interface IEventLoop {
    //
    // The wall clock, in milliseconds.
    //
    nowMs(): number;

    //
    // Gives the event loop one turn, so the promises and callbacks waiting on it run.
    //
    nextTurn(): Promise<void>;

    //
    // How many handles and requests the event loop is holding open right now.
    //
    openCount(): number;
}

//
// How a call ended.
//
export type CallState = "returned" | "threw" | "pending";

//
// What a call did.
//
export interface ICallOutcome {
    //
    // Whether it returned (or its promise fulfilled), threw (or its promise rejected) or never
    // settled.
    //
    state: CallState;

    //
    // What it threw or rejected with, when it did.
    //
    thrown: unknown;

    //
    // Every error that no code caught while the call ran: thrown by a timer it set or by a promise
    // it left rejected with no handler.
    //
    uncaught: unknown[];
}

//
// Collects the errors no code caught while a call runs. The child's own listeners for uncaught
// exceptions and unhandled rejections push into the list.
//
export interface ICallWatch {
    //
    // The errors no code caught since the list was last emptied.
    //
    uncaught: unknown[];
}

//
// Makes the call `invoke` stands for with `subject` in flight and waits for it as described above.
// The subject stays in flight afterwards, so work the call left behind still reaches its world.
//
export async function makeCall(subject: RunSubject, invoke: () => unknown, limits: ICallLimits, eventLoop: IEventLoop, watch: ICallWatch): Promise<ICallOutcome> {
    assert(limits.wallMs > 0);
    assert(limits.afterSettleMs >= 0);
    runWith(subject);
    assert.equal(nowRunning(), subject);
    const baseline = eventLoop.openCount();
    const outcome: ICallOutcome = {
        state: "pending",
        thrown: undefined,
        uncaught: watch.uncaught,
    };
    try {
        const value = runInContext(subject, invoke);
        if (isThenable(value)) {
            value.then(
                () => {
                    outcome.state = "returned";
                },
                (error: unknown) => {
                    outcome.state = "threw";
                    outcome.thrown = error;
                },
            );
        }
        else {
            outcome.state = "returned";
        }
    }
    catch (error) {
        outcome.state = "threw";
        outcome.thrown = error;
    }
    await waitForCall(subject, outcome, limits, eventLoop, baseline);
    assert(outcome.uncaught === watch.uncaught);
    if (outcome.state === "returned") assert.equal(outcome.thrown, undefined);
    withoutRun(() => formatStacks([outcome.thrown, ...outcome.uncaught]));
    assert.equal(nowRunning(), subject, "The call's subject is no longer in flight after the call.");
    return outcome;
}

//
// Formats the stack of every error in `values` now, while no run is in flight. Node formats a stack
// the first time it is read and keeps the text. Formatting reads the working directory, which would
// otherwise be the call's simulated one and a place of the call.
//
export function formatStacks(values: unknown[]): void {
    assert.equal(nowRunning(), undefined, "Stacks were formatted with a run in flight.");
    for (const value of values) {
        if (isError(value)) {
            assert(typeof value.stack === "string" || value.stack === undefined);
        }
    }
}

//
// Runs the event loop and the call's timers until the call has settled and its timers are done or
// due too far ahead, or until it is clear the call will never settle. Once the call has settled, a
// repeating timer it left behind runs once more and is not set again.
//
// Every turn either runs a timer, ends the wait or lets real work go on. The wall-clock limit ends
// the loop whatever the call does, so the loop has an end. Real work is under way when the
// event loop holds more open than `baseline`, what it held before the call.
//
export async function waitForCall(subject: RunSubject, outcome: ICallOutcome, limits: ICallLimits, eventLoop: IEventLoop, baseline: number): Promise<void> {
    assert(limits.wallMs > 0);
    assert(limits.afterSettleMs >= 0);
    assert(baseline >= 0);
    const startedMs = eventLoop.nowMs();
    let settledStampMs: number | undefined;
    let lastActivity = -1;
    let quietTurns = 0;
    while (eventLoop.nowMs() - startedMs <= limits.wallMs) {
        await eventLoop.nextTurn();
        if (outcome.state !== "pending") {
            if (settledStampMs === undefined) {
                settledStampMs = subject.clock.stampMs();
            }
            //
            // Every turn, because a timer that runs after the call settled can set another.
            //
            subject.clock.endRepeats();
        }
        //
        // A request to a server of the run goes through memory a turn at a time and holds no
        // handle open, so while one is moving the loop only turns: a timer run now would move
        // simulated time on before the server answered, and an idle loop is not a call that will
        // never settle. An exchange that has carried nothing for a few turns has gone quiet, as a
        // server that never answers does, and the timers run again, so its timeout runs out.
        //
        if (subject.network.isExchanging()) {
            const activity = subject.network.activityCount();
            if (activity !== lastActivity) {
                lastActivity = activity;
                quietTurns = 0;
                continue;
            }
            quietTurns += 1;
            if (quietTurns < quietTurnsMost) {
                continue;
            }
        }
        const dueInMs = subject.clock.nextDueInMs();
        if (dueInMs !== undefined) {
            assert(dueInMs >= 0);
            if (settledStampMs !== undefined) {
                if (subject.clock.stampMs() + dueInMs > settledStampMs + limits.afterSettleMs) {
                    return;
                }
            }
            runTimer(subject, outcome);
            continue;
        }
        if (outcome.state !== "pending") {
            return;
        }
        if (eventLoop.openCount() <= baseline) {
            return;
        }
    }
    assert(eventLoop.nowMs() - startedMs > limits.wallMs);
}

//
// How many turns of the event loop a request to a server of the run may carry nothing before it
// counts as quiet. Node moves the bytes of one write through a pair of streams within a turn or
// two, so three turns with none is a server that is not answering.
//
export const quietTurnsMost = 3;

//
// Runs the timer due first. What it throws is an error no code caught, because the timer's work is
// called from the clock and not from anything the code under test wrote.
//
export function runTimer(subject: RunSubject, outcome: ICallOutcome): void {
    assert(subject.clock.nextDueInMs() !== undefined, "A timer was run when none was waiting.");
    const uncaughtBefore = outcome.uncaught.length;
    let ran = false;
    try {
        ran = subject.clock.runNextTimer();
    }
    catch (error) {
        //
        // Only a timer that ran can throw from its work.
        //
        ran = true;
        outcome.uncaught.push(error);
    }
    assert(ran, "The clock ran no timer while one was waiting.");
    assert(outcome.uncaught.length >= uncaughtBefore);
}

//
// Whether a value is a promise, or anything else the way `await` treats a promise.
//
export function isThenable(value: unknown): value is PromiseLike<unknown> {
    if (typeof value === "function") {
        return hasThenMethod(value);
    }
    if (typeof value !== "object") {
        return false;
    }
    if (value === null) {
        return false;
    }
    return hasThenMethod(value);
}

//
// Whether an object or function has a `then` method, which is what `await` looks for.
//
export function hasThenMethod(value: object): boolean {
    if (!("then" in value)) {
        return false;
    }
    return typeof value.then === "function";
}

//
// The event loop of this process: the real clock the replaced globals keep, a turn through
// `setImmediate` and every handle and request the loop reports. Only the child builds one.
//
export class ProcessEventLoop implements IEventLoop {
    //
    // The real clock, kept by the replaced globals from before they replaced `Date`.
    //
    nowMs(): number {
        const now = realNow();
        assert(Number.isFinite(now));
        assert(now >= 0);
        return now;
    }

    //
    // One turn through `setImmediate`, which runs after the promises and callbacks already due.
    //
    nextTurn(): Promise<void> {
        return new Promise((resolve) => {
            setImmediate(resolve);
        });
    }

    //
    // Every handle and request the loop reports as open.
    //
    openCount(): number {
        const open = process.getActiveResourcesInfo().length;
        assert(Number.isInteger(open));
        assert(open >= 0);
        return open;
    }
}
