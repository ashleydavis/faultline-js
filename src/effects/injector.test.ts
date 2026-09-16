import assert from "node:assert/strict";
import test from "node:test";
import { failuresByEffect, pointName, rateByEffect, RunInjector } from "./injector.ts";
import { SeededRng } from "./random.ts";

// Builds an injector that fails only what is asked of it.
function clean(): RunInjector {
    return new RunInjector(new SeededRng(1), "clean");
}

test("a clean injector fails none of its own accord", () => {
    const injector = clean();
    for (let index = 0; index < 200; index += 1) {
        assert.equal(injector.check("net"), undefined);
    }
});

test("a failure asked for is handed to the next call", () => {
    const injector = clean();
    injector.fail("net", "refused");
    assert.equal(injector.check("net"), "refused");
    assert.equal(injector.check("net"), undefined);
});

test("a failure asked for waits for its own effect", () => {
    const injector = clean();
    injector.fail("files", "denied");
    assert.equal(injector.check("net"), undefined);
    assert.equal(injector.check("files"), "denied");
});

test("failures are handed out in the order they were asked for", () => {
    const injector = clean();
    injector.fail("net", "refused");
    injector.fail("net", "timeout");
    assert.equal(injector.check("net"), "refused");
    assert.equal(injector.check("net"), "timeout");
});

test("a failure an effect has no name for is refused", () => {
    assert.throws(() => clean().fail("net", "made up"), /no failure named/);
});

test("clearing takes back what has not been used", () => {
    const injector = clean();
    injector.fail("net", "refused");
    injector.clear();
    assert.equal(injector.check("net"), undefined);
});

test("every failure handed out is written down", () => {
    const injector = clean();
    injector.fail("writer", "short");
    injector.check("writer");
    assert.deepEqual(injector.handedOut, [{ effect: "writer", failure: "short" }]);
});

test("the failures an effect has are the ones it lists", () => {
    assert.deepEqual(clean().failures("files"), failuresByEffect.files);
});

test("the list handed back is a copy", () => {
    const injector = clean();
    injector.failures("net").push("made up");
    assert.deepEqual(injector.failures("net"), failuresByEffect.net);
});

test("a faulting injector fails some calls and not others", () => {
    const injector = new RunInjector(new SeededRng(5), "faulting");
    let failed = 0;
    for (let index = 0; index < 400; index += 1) {
        if (injector.check("net") !== undefined) {
            failed += 1;
        }
    }
    assert.ok(failed > 0, "no call failed");
    assert.ok(failed < 400, "every call failed");
});

test("an effect with no failure of its own never fails", () => {
    const injector = new RunInjector(new SeededRng(5), "faulting");
    for (let index = 0; index < 100; index += 1) {
        assert.equal(injector.check("rng"), undefined);
    }
});

test("a faulting injector only ever hands out that effect's own failures", () => {
    const injector = new RunInjector(new SeededRng(9), "faulting");
    for (let index = 0; index < 200; index += 1) {
        const answer = injector.check("files");
        if (answer !== undefined) {
            assert.ok(failuresByEffect.files.includes(answer));
        }
    }
});

test("a call and a value each fail more rarely than an effect", () => {
    assert.ok((rateByEffect.values ?? 4) > 4);
    assert.ok((rateByEffect.calls ?? 4) > 4);
});

test("a value arriving as nothing is one of the failures a run can ask for", () => {
    const injector = clean();
    injector.fail("values", "null");
    assert.equal(injector.check("values"), "null");
    assert.throws(() => injector.fail("values", "made up"), /no failure named/);
});

test("a point is named by its effect and how many of that effect came before it", () => {
    assert.equal(pointName({ effect: "files", occurrence: 2 }), "files#2");
});

test("a recording injector writes down every place an effect could fail and fails none", () => {
    const injector = new RunInjector(new SeededRng(1), "recording");
    for (let index = 0; index < 3; index += 1) {
        assert.equal(injector.check("files"), undefined);
    }
    assert.equal(injector.check("net"), undefined);
    assert.deepEqual(injector.recorded.map(pointName), ["files#0", "files#1", "files#2", "net#0"]);
});

test("an effect with no failure of its own is not a place worth exploring", () => {
    const injector = new RunInjector(new SeededRng(1), "recording");
    injector.check("rng");
    assert.deepEqual(injector.recorded, []);
});

test("an exploring injector fails the one place it was told and no other", () => {
    const injector = new RunInjector(new SeededRng(1), "exploring");
    injector.explore("files#1", "denied");
    assert.equal(injector.check("files"), undefined);
    assert.equal(injector.check("files"), "denied");
    assert.equal(injector.check("files"), undefined);
    assert.equal(injector.check("net"), undefined);
});

test("an exploring injector told nothing fails nothing", () => {
    const injector = new RunInjector(new SeededRng(1), "exploring");
    for (let index = 0; index < 20; index += 1) {
        assert.equal(injector.check("files"), undefined);
    }
});

test("the place an exploring injector failed is written down", () => {
    const injector = new RunInjector(new SeededRng(1), "exploring");
    injector.explore("net#0", "refused");
    injector.check("net");
    assert.deepEqual(injector.handedOut, [{ effect: "net", failure: "refused" }]);
});

test("two injectors on one seed fail the same calls", () => {
    const left = new RunInjector(new SeededRng(3), "faulting");
    const right = new RunInjector(new SeededRng(3), "faulting");
    for (let index = 0; index < 200; index += 1) {
        assert.equal(left.check("net"), right.check("net"));
    }
});
