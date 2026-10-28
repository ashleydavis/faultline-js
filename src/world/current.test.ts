// Checks that the run in flight and whether the driving has begun are held as a run sets them, and
// cleared when the driving stops.
//
// Each test puts runs in flight and starts or stops the driving, reads back what is held, and stops
// the driving again so the next test starts from nothing.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { isDriving, nowRunning, runInContext, runWith, startDriving, stopDriving, withoutRun } from "./current.ts";
import { RunSubject } from "./subject.ts";

test("nothing is in flight until a run puts itself there", () => {
    assert.equal(nowRunning(), undefined);
});

test("the run put in flight is the one a replacement asks", () => {
    const subject = new RunSubject(1, undefined);
    runWith(subject);
    assert.equal(nowRunning(), subject);
    runWith(undefined);
});

test("putting a run in flight hands back the one that was there", () => {
    const first = new RunSubject(1, undefined);
    const second = new RunSubject(2, undefined);
    runWith(first);
    assert.equal(runWith(second), first);
    runWith(undefined);
});

test("a run left in flight by code under test lands in that run's own tree", () => {
    const subject = new RunSubject(1, undefined);
    startDriving();
    try {
        runWith(subject);
        runWith(undefined);
        assert.equal(nowRunning(), subject);
    }
    finally {
        stopDriving();
    }
});

test("nothing is in flight once the driving is over", () => {
    startDriving();
    runWith(new RunSubject(1, undefined));
    stopDriving();
    assert.equal(nowRunning(), undefined);
});

test("the driving has begun only between starting and stopping it", () => {
    const before = isDriving();
    startDriving();
    try {
        assert.equal(isDriving(), true);
    }
    finally {
        stopDriving();
    }
    assert.equal(before, false);
    assert.equal(isDriving(), false);
});

test("work done without a run sees none in flight, and the run is back afterwards even when the work throws", () => {
    const subject = new RunSubject(1, undefined);
    startDriving();
    runWith(subject);
    assert.equal(withoutRun(() => nowRunning()), undefined);
    assert.equal(nowRunning(), subject);
    assert.throws(() => withoutRun(() => {
        throw new Error("thrown");
    }));
    assert.equal(nowRunning(), subject);
    stopDriving();
});

test("work a call left running reaches the call's own run after the next run is in flight", async () => {
    const first = new RunSubject(1, undefined);
    const second = new RunSubject(2, undefined);
    let release = (): void => undefined;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const seen: (RunSubject | undefined)[] = [];
    runWith(first);
    const leftOver = runInContext(first, async () => {
        await waiting;
        seen.push(nowRunning());
    });
    runWith(second);
    runInContext(second, () => {
        seen.push(nowRunning());
    });
    release();
    await leftOver;
    assert.deepEqual(seen, [second, first]);
    assert.equal(nowRunning(), second);
    runWith(undefined);
    assert.equal(nowRunning(), undefined);
});

test("the tool's own work inside a call's context has no run", () => {
    const subject = new RunSubject(1, undefined);
    const inside = runInContext(subject, () => [nowRunning(), withoutRun(() => nowRunning())]);
    assert.deepEqual(inside, [subject, undefined]);
});
