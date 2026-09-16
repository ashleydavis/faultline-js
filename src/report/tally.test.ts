import assert from "node:assert/strict";
import test from "node:test";
import type { PathSite } from "../discover/paths.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import type { DriveResult } from "../drive/host.ts";
import type { RunModel } from "../model.ts";
import { didRun, tallyWith, type Counts } from "./tally.ts";

// One path, written as short as a test needs it. The line stands in for the place, so a test reads
// as a list of numbers rather than a list of objects.
function site(name: string, fn: string, at: number, against?: number): PathSite {
    return {
        name,
        describe: name,
        file: "a.ts",
        line: 1,
        fn,
        at: { line: at, column: 0 },
        against: against === undefined ? undefined : { line: against, column: 0 },
    };
}

// Counts written as a list, one per line of the file above.
function counting(perLine: number[]): Counts {
    return { at: (file, place) => (file === "a.ts" ? (perLine[place.line] ?? 0) : 0) };
}

// One function that can be reached.
function held(label: string): FunctionInfo {
    return { label, file: "a.ts", line: 1, reach: { how: "export", name: label }, parameters: [], async: false };
}

// A model over one file.
function model(functions: FunctionInfo[], paths: PathSite[]): RunModel {
    return {
        root: "/tmp",
        work: "/tmp/w",
        files: [{ file: "a.ts", module: "/tmp/w/a.mjs", functions, classes: [], paths }],
        factories: [],
        scenarios: [],
        invariants: [],
        simModules: {},
        unseen: [],
        seeds: [1],
        callBudget: 5000,
    };
}

// What the driving came back with, written as short as a test needs it.
function result(over: Partial<DriveResult> = {}): DriveResult {
    return {
        scripts: new Map(),
        calls: new Map(),
        stepped: 0,
        hung: 0,
        died: 0,
        hungFunctions: new Set(),
        cannotBuild: new Map(),
        done: 0,
        rounds: 1,
        ...over,
    };
}

test("a path with a place of its own ran when V8 counted that place as run", () => {
    assert.equal(didRun(site("p", "f", 0), counting([1])), true);
    assert.equal(didRun(site("p", "f", 0), counting([0])), false);
    assert.equal(didRun(site("p", "f", 0), counting([])), false);
});

test("a path counted against another ran when its own place ran more often", () => {
    assert.equal(didRun(site("p", "f", 0, 1), counting([5, 2])), true);
    assert.equal(didRun(site("p", "f", 0, 1), counting([5, 5])), false);
    assert.equal(didRun(site("p", "f", 0, 1), counting([2, 5])), false);
});

test("a path in a file the run never loaded never ran", () => {
    assert.equal(didRun({ ...site("p", "f", 0), file: "gone.ts" }, counting([1])), false);
});

test("the paths of a file are counted per function", () => {
    const counted = tallyWith(
        model([held("f"), held("g")], [site("a", "f", 0), site("b", "f", 1), site("c", "g", 2)]),
        result(),
        counting([1, 0, 1]),
    );
    assert.equal(counted.files[0]?.functions[0]?.paths.length, 2);
    assert.equal(counted.files[0]?.functions[0]?.ticked, 1);
    assert.equal(counted.files[0]?.functions[1]?.ticked, 1);
});

test("the totals are every path and every one that ran", () => {
    const counted = tallyWith(model([held("f")], [site("a", "f", 0), site("b", "f", 1)]), result(), counting([1, 0]));
    assert.equal(counted.total, 2);
    assert.equal(counted.ticked, 1);
});

test("a file is complete when every path in it ran", () => {
    assert.equal(tallyWith(model([held("f")], [site("a", "f", 0)]), result(), counting([1])).files[0]?.complete, true);
    assert.equal(tallyWith(model([held("f")], [site("a", "f", 0)]), result(), counting([0])).files[0]?.complete, false);
});

test("how many calls a function took is carried through", () => {
    const counted = tallyWith(
        model([held("f")], [site("a", "f", 0)]),
        result({ calls: new Map([["a.ts#f", 12]]) }),
        counting([1]),
    );
    assert.equal(counted.files[0]?.functions[0]?.calls, 12);
});

test("what a function needs before it can be called is carried through", () => {
    const counted = tallyWith(
        model([held("f")], [site("a", "f", 0)]),
        result({ cannotBuild: new Map([["a.ts#f", { parameter: "store", typeText: "Store" }]]) }),
        counting([0]),
    );
    assert.deepEqual(counted.files[0]?.functions[0]?.needs, { parameter: "store", typeText: "Store" });
});

test("a function that never returned is marked as one", () => {
    const counted = tallyWith(
        model([held("f")], [site("a", "f", 0)]),
        result({ hungFunctions: new Set(["a.ts#f"]) }),
        counting([0]),
    );
    assert.equal(counted.files[0]?.functions[0]?.hung, true);
});

test("a file that declares no function is named rather than counted", () => {
    const counted = tallyWith(model([], []), result(), counting([]));
    assert.deepEqual(counted.empty, ["a.ts"]);
    assert.deepEqual(counted.files, []);
});

test("a function with no path of its own counts as complete", () => {
    const counted = tallyWith(model([held("f")], []), result(), counting([]));
    assert.equal(counted.files[0]?.complete, true);
    assert.equal(counted.total, 0);
});
