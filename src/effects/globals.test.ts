import assert from "node:assert/strict";
import test from "node:test";
import { runWith } from "./current.ts";
import { installGlobals, realNow, removeGlobals } from "./globals.ts";
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

test("a call that waits costs the run no time and moves its clock forward", async () => {
    const seen = await new Promise<{ before: number; after: number }>((settle) => {
        installGlobals();
        const subject = new RunSubject(7, "clean");
        const held = runWith(subject);
        const before = Date.now();
        setTimeout(() => {
            const after = Date.now();
            runWith(held);
            removeGlobals();
            settle({ before, after });
        }, 3600000);
    });
    assert.equal(seen.after - seen.before, 3600000);
});

test("a repeating timer runs one turn, so the run gets past it", async () => {
    const turns = await new Promise<number>((settle) => {
        installGlobals();
        const held = runWith(new RunSubject(7, "clean"));
        let count = 0;
        setInterval(() => {
            count += 1;
        }, 10);
        queueMicrotask(() => {
            queueMicrotask(() => {
                runWith(held);
                removeGlobals();
                settle(count);
            });
        });
    });
    assert.equal(turns, 1);
});

test("a store a page keeps things in is one a run owns", () => {
    const global = globalThis as unknown as Record<string, unknown>;
    Object.defineProperty(global, "localStorage", { value: { getItem: () => null }, configurable: true });
    try {
        const seen = whileRunning(() => {
            const store = global.localStorage as Storage;
            store.setItem("a", "b");
            return store.getItem("a");
        });
        assert.equal(seen, "b");
    }
    finally {
        delete global.localStorage;
    }
});

test("the machine's own clock is held from before anything was replaced", () => {
    // A run measuring the file that replaces the globals loads a copy of it, and that copy replaces
    // the clock of the process the driver is in. The driver times itself, and reading the replaced
    // clock got it whatever the code under test was given.
    installGlobals();
    const held = runWith(new RunSubject(7, "clean"));
    try {
        assert.equal(Date.now(), 1704067200000);
        assert.notEqual(realNow(), 1704067200000);
    }
    finally {
        runWith(held);
        removeGlobals();
    }
});
