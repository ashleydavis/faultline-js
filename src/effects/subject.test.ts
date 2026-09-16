import assert from "node:assert/strict";
import test from "node:test";
import { RunChecklist, RunSubject } from "./subject.ts";

test("a subject carries every effect a run supplies", () => {
    const subject = new RunSubject(1, "clean");
    for (const effect of [subject.rng, subject.injector, subject.clock, subject.net, subject.files, subject.writer]) {
        assert.notEqual(effect, undefined);
    }
});

test("a scenario reads back what a writer took", async () => {
    const subject = new RunSubject(1, "clean");
    await subject.writer.write("put out");
    assert.equal(subject.writer.written(), "put out");
});

test("two subjects on one seed draw the same values", () => {
    const left = new RunSubject(5, "clean");
    const right = new RunSubject(5, "clean");
    for (let index = 0; index < 50; index += 1) {
        assert.equal(left.rng.next(), right.rng.next());
    }
});

test("a clean subject breaks none of its effects on its own", async () => {
    const subject = new RunSubject(1, "clean");
    for (let index = 0; index < 50; index += 1) {
        assert.equal(await subject.writer.write("x"), 1);
    }
});

test("a faulting subject breaks some of its calls", async () => {
    const subject = new RunSubject(2, "faulting");
    let broke = 0;
    for (let index = 0; index < 100; index += 1) {
        try {
            await subject.files.read("/settings.json");
        }
        catch {
            broke += 1;
        }
    }
    assert.ok(broke > 0, "no call was broken");
});

test("the checklist says which path names have been ticked", () => {
    const checklist = new RunChecklist(new Set(["b", "a"]));
    assert.equal(checklist.ticked("a"), true);
    assert.equal(checklist.ticked("missing"), false);
    assert.deepEqual(checklist.names(), ["a", "b"]);
});
