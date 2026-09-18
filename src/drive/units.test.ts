import assert from "node:assert/strict";
import test from "node:test";
import type { FunctionInfo } from "../discover/functions.ts";
import type { RunModel } from "../model.ts";
import { buildExploration, buildUnits, callsPerUnit, isFaulting } from "./units.ts";

// A function that can be reached, for a model a test builds.
function reachable(label: string): FunctionInfo {
    return { label, file: "a.ts", line: 1, reach: { how: "export", name: label }, parameters: [], async: false };
}

// A function nothing can call directly.
function inside(label: string): FunctionInfo {
    return { label, file: "a.ts", line: 1, reach: { how: "inside", because: "hidden" }, parameters: [], async: false };
}

// A model with the seeds, functions and scenarios a test wants.
function model(seeds: number[], functions: FunctionInfo[], scenarios = 0): RunModel {
    return {
        root: "/tmp",
        work: "/tmp/work",
        files: [{ file: "a.ts", module: "/tmp/work/a.mjs", functions, classes: [], paths: [] }],
        factories: [],
        scenarios: Array.from({ length: scenarios }, (_, index) => ({
            file: "a.sim.ts",
            exportName: `s${index}`,
            line: 1,
            module: "/tmp/work/a.sim.mjs",
        })),
        invariants: [],
        simModules: {},
        unseen: [],
        seeds,
        callBudget: 5000,
    };
}

test("one unit is made for every function and every seed", () => {
    const units = buildUnits(model([1, 2], [reachable("a"), reachable("b")]));
    assert.equal(units.length, 4);
});

test("a function nothing can call directly gets no unit of its own", () => {
    const units = buildUnits(model([1], [reachable("a"), inside("b")]));
    assert.equal(units.length, 1);
    assert.equal(units[0]?.fn, 0);
});

test("scenarios come first, because a scenario is what somebody wrote to reach a path", () => {
    const units = buildUnits(model([1, 2], [reachable("a")], 1));
    assert.deepEqual(units.map((one) => one.kind), ["scenario", "scenario", "call", "call"]);
});

test("every unit is numbered in order, so a restart lands where it means to", () => {
    const units = buildUnits(model([1, 2, 3], [reachable("a"), reachable("b")], 2));
    assert.deepEqual(units.map((one) => one.index), [...units.keys()]);
});

test("the first seed breaks none of its effects, so a clean pass comes first", () => {
    const one = model([4, 5, 6], [reachable("a")]);
    assert.equal(isFaulting(one, 4), false);
    assert.equal(isFaulting(one, 5), true);
});

test("a scenario never runs against effects that fail of their own accord", () => {
    const units = buildUnits(model([1, 2, 3], [reachable("a")], 1));
    for (const one of units) {
        if (one.kind === "scenario") {
            assert.equal(one.faulting, false);
        }
    }
});

test("a call still runs against effects that fail, on every seed past the first", () => {
    const units = buildUnits(model([1, 2], [reachable("a")], 1));
    assert.deepEqual(units.filter((one) => one.kind === "call").map((one) => one.faulting), [false, true]);
});

test("the units say which seed each one runs against", () => {
    const units = buildUnits(model([7, 8], [reachable("a")]));
    assert.deepEqual(units.map((one) => one.seed), [7, 8]);
});

test("a later round drives only the functions that still have a path left", () => {
    const one = model([1], [reachable("a"), reachable("b")]);
    const units = buildExploration(one, new Set(["a.ts#b"]), 9);
    assert.equal(units.length, 1);
    assert.equal(units[0]?.fn, 1);
    assert.equal(units[0]?.kind, "explore");
    assert.equal(units[0]?.seed, 9);
});

test("a later round with everything reached has no work in it", () => {
    assert.deepEqual(buildExploration(model([1], [reachable("a")]), new Set(), 9), []);
});

test("a function nothing can call directly is not explored either", () => {
    assert.deepEqual(buildExploration(model([1], [inside("a")]), new Set(["a.ts#a"]), 9), []);
});

test("a model with no function and no scenario has no work in it", () => {
    assert.deepEqual(buildUnits(model([1], [])), []);
});

test("a unit makes more than one call, so more of a function's inputs are tried", () => {
    assert.ok(callsPerUnit > 1);
});
