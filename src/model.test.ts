import assert from "node:assert/strict";
import test from "node:test";
import { formatPlan, parsePlan } from "./model.ts";

test("a plan with only a seed is written and read back the same", () => {
    assert.equal(formatPlan({ seed: 17 }), "seed=17");
    assert.deepEqual(parsePlan("seed=17"), { seed: 17, fn: undefined });
});

test("a plan naming a function carries it both ways", () => {
    assert.equal(formatPlan({ seed: 3, fn: "a.ts#greet" }), "seed=3,fn=a.ts#greet");
    assert.deepEqual(parsePlan("seed=3,fn=a.ts#greet"), { seed: 3, fn: "a.ts#greet" });
});

test("spaces around a part are allowed", () => {
    assert.deepEqual(parsePlan(" seed=1 , fn=x "), { seed: 1, fn: "x" });
});

test("an empty part is passed over", () => {
    assert.deepEqual(parsePlan("seed=1,"), { seed: 1, fn: undefined });
});

test("a plan with no seed is refused, because it reproduces no run", () => {
    assert.throws(() => parsePlan("fn=x"), /names no seed/);
    assert.throws(() => parsePlan(""), /names no seed/);
});

test("a part with no value is refused", () => {
    assert.throws(() => parsePlan("seed"), /no value/);
});

test("a seed that is not a whole number is refused", () => {
    assert.throws(() => parsePlan("seed=x"), /not a whole number/);
    assert.throws(() => parsePlan("seed=1.5"), /not a whole number/);
});

test("a part a plan has no name for is refused rather than passed over", () => {
    assert.throws(() => parsePlan("seed=1,made-up=2"), /has no part called/);
});
