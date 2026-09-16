import assert from "node:assert/strict";
import test from "node:test";
import type { PathSite } from "../discover/paths.ts";
import type { RunModel } from "../model.ts";
import type { Counts } from "../report/tally.ts";
import { startupBudget, unreachedFunctions } from "./host.ts";

test("starting up is allowed longer than a call", () => {
    assert.ok(startupBudget(700) > 700);
    assert.equal(startupBudget(700), 30000);
});

test("a budget longer than the allowance for starting up is used for both", () => {
    assert.equal(startupBudget(60000), 60000);
});

// A model over one file, with the paths a test wants.
function model(paths: PathSite[]): RunModel {
    return {
        root: "/tmp",
        work: "/tmp/w",
        files: [{ file: "a.ts", module: "/tmp/w/a.mjs", functions: [], classes: [], paths }],
        factories: [],
        scenarios: [],
        invariants: [],
        simModules: {},
        unseen: [],
        seeds: [1],
        callBudget: 5000,
    };
}

// One path, written as short as a test needs it. The line stands in for the place.
function site(fn: string, at: number): PathSite {
    return { name: `p${at}`, describe: "a path", file: "a.ts", line: 1, fn, at: { line: at, column: 0 } };
}

// Counts written as a list, one per line of the file above.
function counting(perLine: number[]): Counts {
    return { at: (file, place) => (file === "a.ts" ? (perLine[place.line] ?? 0) : 0) };
}

test("a function with a path nothing reached is what a later round drives", () => {
    const left = unreachedFunctions(model([site("f", 0), site("g", 1)]), counting([1, 0]));
    assert.deepEqual([...left], ["a.ts#g"]);
});

test("a run with every path reached leaves a later round nothing to drive", () => {
    assert.equal(unreachedFunctions(model([site("f", 0)]), counting([1])).size, 0);
});
