import assert from "node:assert/strict";
import test from "node:test";
import { nowRunning, runWith, startDriving, stopDriving } from "./current.ts";
import { RunSubject } from "./subject.ts";

test("nothing is in flight until a run puts itself there", () => {
    assert.equal(nowRunning(), undefined);
});

test("the run put in flight is the one a replacement asks", () => {
    const subject = new RunSubject(1, "clean");
    runWith(subject);
    assert.equal(nowRunning(), subject);
    runWith(undefined);
});

test("putting a run in flight hands back the one that was there", () => {
    const first = new RunSubject(1, "clean");
    const second = new RunSubject(2, "clean");
    runWith(first);
    assert.equal(runWith(second), first);
    runWith(undefined);
});

test("a run left in flight by code under test lands in that run's own tree", () => {
    const subject = new RunSubject(1, "clean");
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
    runWith(new RunSubject(1, "clean"));
    stopDriving();
    assert.equal(nowRunning(), undefined);
});
