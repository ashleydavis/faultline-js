import assert from "node:assert/strict";
import test from "node:test";
import { runWith } from "./current.ts";
import { installGlobals, removeGlobals } from "./globals.ts";
import { RunSubject } from "./subject.ts";

// Runs `work` with one run in flight and the globals replaced, and puts the runtime back after.
function whileRunning<T>(work: (subject: RunSubject) => T): T {
    installGlobals();
    const subject = new RunSubject(7, "clean");
    const before = runWith(subject);
    try {
        return work(subject);
    }
    finally {
        runWith(before);
        removeGlobals();
    }
}

test("the clock a run owns is what Date.now reads", () => {
    const seen = whileRunning((subject) => ({ global: Date.now(), own: subject.clock.now() }));
    assert.equal(seen.global, seen.own);
});

test("a date built with no argument reads the run's clock", () => {
    const seen = whileRunning(() => new Date().getTime());
    assert.equal(seen, 1704067200000);
});

test("a date built with an argument is the date that argument names", () => {
    const seen = whileRunning(() => new Date(86400000).getTime());
    assert.equal(seen, 86400000);
});

test("two runs of one seed draw the same numbers from Math.random", () => {
    const first = whileRunning(() => [Math.random(), Math.random()]);
    const second = whileRunning(() => [Math.random(), Math.random()]);
    assert.deepEqual(first, second);
});

test("the network a run owns is what fetch reaches", async () => {
    const answer = await whileRunning(async () => fetch("https://example.com/"));
    assert.ok(answer instanceof Response);
});

test("the clock is the machine's again once the globals are put back", () => {
    whileRunning(() => undefined);
    assert.ok(Math.abs(Date.now() - new Date().getTime()) < 1000);
    assert.notEqual(Date.now(), 1704067200000);
});

test("a call made with no run in flight reads the machine's own clock", () => {
    installGlobals();
    try {
        assert.notEqual(Date.now(), 1704067200000);
    }
    finally {
        removeGlobals();
    }
});
