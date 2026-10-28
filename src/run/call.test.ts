//
// Checks that a call is waited for the way the run loop needs: one that returns or throws at once,
// one whose promise settles only after its simulated timers run, one that can never settle, one
// that real work may still settle, a timer left behind that keeps repeating and a timer that throws.
// It also checks how a thenable and a set of limits are told apart.
// The timers are set straight on the subject's clock, which is what the replaced globals do. The
// event loop is a stand-in whose wall clock moves on a fixed step each turn and whose turns are
// microtasks, so a call waited on until the wall-clock limit is judged without any real waiting.
//

import assert from "node:assert/strict";
import { afterEach, describe, test } from "@jest/globals";
import { nowRunning, runWith } from "../world/current.ts";
import { RunSubject } from "../world/subject.ts";
import { formatStacks, hasThenMethod, isCallLimits, isThenable, makeCall, ProcessEventLoop, quietTurnsMost, runTimer, type ICallLimits, type ICallOutcome, type ICallWatch, type IEventLoop } from "./call.ts";

//
// Limits short enough for a test to wait out: a tenth of a second of wall clock and timers due up
// to a minute after the call settled.
//
const limits: ICallLimits = {
    wallMs: 100,
    afterSettleMs: 60000,
};

//
// How far the stand-in's wall clock moves on each turn of its event loop, in milliseconds. It
// divides the wall-clock limit evenly, so a test can say exactly how many turns the limit allows.
//
const turnStepMs = 10;

//
// A stand-in event loop and how many turns it gave.
//
export interface IFakeEventLoop extends IEventLoop {
    //
    // The turns given so far.
    //
    turns: number;

    //
    // What the real work count reads.
    //
    work: number;
}

//
// An event loop whose wall clock starts at 0 and moves on `turnStepMs` each turn, whose turns let
// the waiting promises run and whose real work reads `work`.
//
export function createFakeEventLoop(work: number): IFakeEventLoop {
    const loop: IFakeEventLoop = {
        turns: 0,
        work,
        nowMs: () => loop.turns * turnStepMs,
        async nextTurn(): Promise<void> {
            loop.turns += 1;
            await Promise.resolve();
            await Promise.resolve();
        },
        openCount: () => loop.work,
    };
    return loop;
}

//
// A process with no real work under way.
//
const idle: IEventLoop = createFakeEventLoop(0);

//
// A watch that has seen no error no code caught. Each call gets its own, because a call adds to
// the list it is given.
//
export function emptyWatch(): ICallWatch {
    return {
        uncaught: [],
    };
}

afterEach(() => {
    runWith(undefined);
});

describe("makeCall", () => {
    test("a call that returns at once has returned and its subject stays in flight", async () => {
        const subject = new RunSubject(1, undefined);
        const outcome = await makeCall(subject, () => 5, limits, idle, emptyWatch());
        assert.equal(outcome.state, "returned");
        assert.equal(nowRunning(), subject);
    });

    test("a call that throws at once has thrown what it threw", async () => {
        const error = new Error("no");
        const outcome = await makeCall(new RunSubject(1, undefined), () => {
            throw error;
        }, limits, idle, emptyWatch());
        assert.equal(outcome.state, "threw");
        assert.equal(outcome.thrown, error);
    });

    test("a promise that waits an hour of simulated time settles at once and one that rejects has thrown", async () => {
        const subject = new RunSubject(1, undefined);
        const started = subject.clock.stampMs();
        const outcome = await makeCall(subject, () => new Promise((resolve) => {
            subject.clock.setTimer(3600000, () => resolve("done"), false);
        }), limits, idle, emptyWatch());
        assert.equal(outcome.state, "returned");
        assert.equal(subject.clock.stampMs() - started, 3600000);
        const rejected = await makeCall(new RunSubject(1, undefined), () => Promise.reject(new Error("late")), limits, idle, emptyWatch());
        assert.equal(rejected.state, "threw");
        assert.ok(rejected.thrown instanceof Error);
        assert.equal(rejected.thrown.message, "late");
    });

    test("a call waiting on a promise no timer and no real work can settle never settles and that is known at once", async () => {
        const loop = createFakeEventLoop(0);
        const outcome = await makeCall(new RunSubject(1, undefined), () => new Promise(() => undefined), {
            ...limits,
            wallMs: 60000,
        }, loop, {
            uncaught: [],
        });
        assert.equal(outcome.state, "pending");
        assert.equal(loop.turns, 1);
    });

    test("a call waiting while real work is under way is waited for until the wall-clock limit", async () => {
        const loop = createFakeEventLoop(0);
        const outcome = await makeCall(new RunSubject(1, undefined), () => {
            loop.work = 1;
            return new Promise(() => undefined);
        }, limits, loop, emptyWatch());
        assert.equal(outcome.state, "pending");
        assert.equal(loop.turns, limits.wallMs / turnStepMs + 1);
    });

    test("work the event loop held before the call does not keep the call waiting", async () => {
        const loop = createFakeEventLoop(3);
        const outcome = await makeCall(new RunSubject(1, undefined), () => new Promise(() => undefined), limits, loop, emptyWatch());
        assert.equal(outcome.state, "pending");
        assert.equal(loop.turns, 1);
    });

    test("while a request to a server of the run is under way the call's timers wait, so the server answers before a timeout runs out", async () => {
        const subject = new RunSubject(1, undefined);
        const loop = createFakeEventLoop(0);
        const settled: string[] = [];
        const outcome = await makeCall(subject, () => new Promise<void>((resolve) => {
            subject.clock.setTimer(5000, () => {
                settled.push("timed out");
                resolve();
            }, false);
            subject.network.startExchange();
            let turns = 0;
            const answerLater = (): void => {
                turns += 1;
                if (turns < 3) {
                    queueMicrotask(answerLater);
                    return;
                }
                subject.network.endExchange();
                settled.push("answered");
                resolve();
            };
            queueMicrotask(answerLater);
        }), limits, loop, emptyWatch());
        assert.equal(outcome.state, "returned");
        //
        // The timeout runs too, as a timer the call left behind, but only after the answer.
        //
        assert.equal(settled[0], "answered");
        assert.equal(subject.network.isExchanging(), false);
    });

    test("an exchange that keeps carrying bytes holds the timers back for as long as it moves", async () => {
        const subject = new RunSubject(1, undefined);
        const loop = createFakeEventLoop(0);
        const settled: string[] = [];
        let turns = 0;
        const outcome = await makeCall(subject, () => new Promise<void>((resolve) => {
            subject.clock.setTimer(5000, () => {
                settled.push("timed out");
                resolve();
            }, false);
            subject.network.startExchange();
            const carry = (): void => {
                turns += 1;
                subject.network.noteActivity();
                if (loop.turns < 10) {
                    queueMicrotask(carry);
                    return;
                }
                subject.network.endExchange();
                settled.push("answered");
                resolve();
            };
            queueMicrotask(carry);
        }), limits, loop, emptyWatch());
        assert.equal(outcome.state, "returned");
        assert.equal(settled[0], "answered");
        assert.ok(turns > 0);
        assert.ok(subject.network.activityCount() > 0);
    });

    test("an exchange that carries nothing for a few turns has gone quiet, and the timers run so its timeout runs out", async () => {
        const subject = new RunSubject(1, undefined);
        const loop = createFakeEventLoop(0);
        const settled: string[] = [];
        const outcome = await makeCall(subject, () => new Promise<void>((resolve) => {
            subject.clock.setTimer(5000, () => {
                settled.push("timed out");
                resolve();
            }, false);
            subject.network.startExchange();
        }), limits, loop, emptyWatch());
        assert.equal(outcome.state, "returned");
        assert.deepEqual(settled, ["timed out"]);
        assert.ok(loop.turns > quietTurnsMost);
        assert.equal(subject.network.isExchanging(), true);
    });

    test("a timer left repeating after the call settled runs once more and is not set again", async () => {
        const subject = new RunSubject(1, undefined);
        let turns = 0;
        const outcome = await makeCall(subject, () => {
            subject.clock.setTimer(1, () => {
                turns += 1;
            }, true);
        }, {
            ...limits,
            wallMs: 60000,
        }, idle, emptyWatch());
        assert.equal(outcome.state, "returned");
        assert.equal(turns, 1);
        assert.equal(subject.clock.hasTimers(), false);
    });

    test("a timer the call left due further ahead than the time after it settled never runs", async () => {
        const subject = new RunSubject(1, undefined);
        let ran = false;
        const outcome = await makeCall(subject, () => {
            subject.clock.setTimer(limits.afterSettleMs + 1000, () => {
                ran = true;
            }, false);
        }, limits, idle, emptyWatch());
        assert.equal(outcome.state, "returned");
        assert.equal(ran, false);
        assert.equal(subject.clock.hasTimers(), true);
    });

    test("a repeating timer set by a timer that ran after the call settled runs once too", async () => {
        const subject = new RunSubject(1, undefined);
        let inner = 0;
        const outcome = await makeCall(subject, () => {
            subject.clock.setTimer(5, () => {
                subject.clock.setTimer(1, () => {
                    inner += 1;
                }, true);
            }, false);
        }, limits, idle, emptyWatch());
        assert.equal(outcome.state, "returned");
        assert.equal(inner, 1);
        assert.equal(subject.clock.hasTimers(), false);
    });

    test("a repeating timer keeps repeating while the call it was set for has not settled", async () => {
        const subject = new RunSubject(1, undefined);
        let turns = 0;
        const outcome = await makeCall(subject, () => new Promise((resolve) => {
            subject.clock.setTimer(10, () => {
                turns += 1;
                if (turns === 3) {
                    resolve("done");
                }
            }, true);
        }), limits, idle, emptyWatch());
        assert.equal(outcome.state, "returned");
        assert.equal(turns, 4);
        assert.equal(subject.clock.hasTimers(), false);
    });

    test("what a timer throws is an error no code caught, kept in the watch's list", async () => {
        const subject = new RunSubject(1, undefined);
        const watch: ICallWatch = {
            uncaught: [],
        };
        const outcome = await makeCall(subject, () => {
            subject.clock.setTimer(5, () => {
                throw new Error("from a timer");
            }, false);
        }, limits, idle, watch);
        assert.equal(outcome.uncaught, watch.uncaught);
        const uncaught = watch.uncaught[0];
        assert.ok(uncaught instanceof Error);
        assert.equal(uncaught.message, "from a timer");
    });
});

describe("the parts", () => {
    test("a thenable is an object or function with a then method", () => {
        assert.equal(isThenable(Promise.resolve(1)), true);
        assert.equal(isThenable({
            then: () => undefined,
        }), true);
        assert.equal(isThenable(Object.assign(() => undefined, {
            then: () => undefined,
        })), true);
        assert.equal(isThenable({
            then: 1,
        }), false);
        assert.equal(isThenable(null), false);
        assert.equal(isThenable(3), false);
    });

    test("a turn of the process's event loop runs what was waiting on it, without waiting on a timer", async () => {
        let ran = false;
        setImmediate(() => {
            ran = true;
        });
        await new ProcessEventLoop().nextTurn();
        assert.equal(ran, true);
    });

    test("stacks are formatted for errors and for errors with no stack while anything else is left alone", () => {
        const stacked = new Error("p");
        const bare = new Error("b");
        bare.stack = undefined;
        formatStacks([stacked, bare, "not an error", undefined]);
        assert.match(stacked.stack!, /^Error: p/);
        assert.equal(bare.stack, undefined);
    });

    test("the process's real work is what the event loop holds open and its clock is the real one", () => {
        const loop = new ProcessEventLoop();
        assert.equal(loop.openCount(), process.getActiveResourcesInfo().length);
        const before = Date.now();
        const read = loop.nowMs();
        assert.ok(read >= before);
        assert.ok(read <= Date.now());
    });

    test("a thenable's then is looked for on objects and functions alike", () => {
        assert.equal(hasThenMethod({
            then: () => undefined,
        }), true);
        assert.equal(hasThenMethod({
            then: "later",
        }), false);
        assert.equal(hasThenMethod({}), false);
        assert.equal(hasThenMethod(() => undefined), false);
    });

    test("stacks are formatted only while no run is in flight", () => {
        runWith(new RunSubject(1, undefined));
        assert.throws(() => formatStacks([new Error("in a run")]), /Stacks were formatted with a run in flight\./);
    });

    test("a timer that throws counts as run; running one when none waits is a defect", () => {
        const subject = new RunSubject(1, undefined);
        const outcome: ICallOutcome = {
            state: "pending",
            thrown: undefined,
            uncaught: [],
        };
        assert.throws(() => runTimer(subject, outcome), /A timer was run when none was waiting\./);
        subject.clock.setTimer(5, () => {
            throw new Error("from a timer");
        }, false);
        runTimer(subject, outcome);
        assert.equal(outcome.uncaught.length, 1);
        assert.equal(subject.clock.hasTimers(), false);
    });

    test("limits are read only when both of them are numbers", () => {
        assert.equal(isCallLimits(limits), true);
        assert.equal(isCallLimits("limits"), false);
        assert.equal(isCallLimits(null), false);
        assert.equal(isCallLimits({}), false);
        assert.equal(isCallLimits({
            wallMs: "100",
        }), false);
        assert.equal(isCallLimits({
            wallMs: 100,
        }), false);
        assert.equal(isCallLimits({
            wallMs: 100,
            afterSettleMs: "60000",
        }), false);
    });
});
