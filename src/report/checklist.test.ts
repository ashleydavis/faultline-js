import assert from "node:assert/strict";
import test from "node:test";
import type { PathSite } from "../discover/paths.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import { checklistFor, missedHeading, missedLine } from "./checklist.ts";
import type { FunctionTally, RunTally } from "./tally.ts";

// One path, written as short as a test needs it.
function site(name: string, fn = "f", line = 1): PathSite {
    return { name, describe: `the ${name} of it`, file: "a.ts", line, fn, at: { line, column: 0 } };
}

// One function the report would give a line to.
function held(label = "f", reach: FunctionInfo["reach"] = { how: "export", name: "f" }): FunctionInfo {
    return { label, file: "a.ts", line: 4, reach, parameters: [], async: false };
}

// A tally over one function.
function one(over: Partial<FunctionTally> = {}): RunTally {
    const made: FunctionTally = {
        held: held(),
        paths: [{ site: site("body"), ticked: true }],
        ticked: 1,
        calls: 4,
        hung: false,
        ...over,
    };
    return {
        files: [{ file: "a.ts", functions: [made], complete: made.ticked === made.paths.length }],
        total: made.paths.length,
        ticked: made.ticked,
        empty: [],
    };
}

test("a run with every path reached has an empty list", () => {
    const list = checklistFor(one());
    assert.deepEqual(list.missed, []);
    assert.deepEqual(list.todo, []);
});

test("a path no call reached is named, with why", () => {
    const list = checklistFor(one({ paths: [{ site: site("body"), ticked: false }], ticked: 0 }));
    assert.equal(list.missed.length, 1);
    assert.match(list.missed[0]!.because, /no call/);
});

test("a path no call reached asks for a scenario, naming the file and the line", () => {
    const list = checklistFor(one({ paths: [{ site: site("body", "f", 9), ticked: false }], ticked: 0 }));
    assert.equal(list.todo.length, 1);
    assert.match(list.todo[0]!, /Write a scenario reaching the body of it at a\.ts:9 in f\./);
});

test("a function that cannot be called asks for a test input factory instead", () => {
    const list = checklistFor(
        one({
            calls: 0,
            needs: { parameter: "store", typeText: "Store" },
            paths: [{ site: site("body"), ticked: false }],
            ticked: 0,
        }),
    );
    assert.equal(list.todo.length, 1);
    assert.match(list.todo[0]!, /Write a test input factory returning Store, which f takes as `store`\./);
});

test("the paths of a function that cannot be called are left off, because the factory is the work", () => {
    const list = checklistFor(
        one({
            calls: 0,
            needs: { parameter: "store", typeText: "Store" },
            paths: [{ site: site("body"), ticked: false }, { site: site("other"), ticked: false }],
            ticked: 0,
        }),
    );
    assert.deepEqual(list.missed, []);
});

test("a function that never returned says so rather than asking for a factory", () => {
    const list = checklistFor(one({ calls: 0, hung: true, paths: [{ site: site("body"), ticked: false }], ticked: 0 }));
    assert.match(list.todo[0]!, /ran past the budget without returning/);
});

test("a function that returned for one input and ran for ever on another still says so", () => {
    const list = checklistFor(one({ calls: 12, hung: true, paths: [{ site: site("body"), ticked: false }], ticked: 0 }));
    assert.match(list.todo[0]!, /ran past the budget without returning/);
});

test("a function that ran past the budget and still covered every path asks for nothing", () => {
    const list = checklistFor(one({ calls: 12, hung: true }));
    assert.deepEqual(list.todo, []);
});

test("a method on a class the file does not export asks for the class to be exported", () => {
    const list = checklistFor(
        one({
            held: held("Store.read", { how: "method", className: "Store", classExport: "", name: "read", onClass: false, accessor: "none" }),
            calls: 0,
            paths: [{ site: site("body", "Store.read"), ticked: false }],
            ticked: 0,
        }),
    );
    assert.match(list.todo[0]!, /Export the class Store at a\.ts:4 so Store\.read can be called\./);
});

test("what a function needs comes before the paths that are only missing a scenario", () => {
    const tally = one({ paths: [{ site: site("body"), ticked: false }], ticked: 0 });
    tally.files[0]!.functions.push({
        held: held("g", { how: "export", name: "g" }),
        paths: [{ site: site("other", "g"), ticked: false }],
        ticked: 0,
        calls: 0,
        hung: false,
        needs: { parameter: "s", typeText: "Store" },
    });
    const list = checklistFor(tally);
    assert.match(list.todo[0]!, /test input factory/);
    assert.match(list.todo[1]!, /Write a scenario/);
});

test("the heading counts the paths and reads as a sentence either way", () => {
    assert.equal(missedHeading(1), "FAIL 1 code path that no call reached:");
    assert.equal(missedHeading(3), "FAIL 3 code paths that no call reached:");
});

test("a missed path is written with its file, its line, its name and its function", () => {
    assert.equal(
        missedLine({ site: site("if:9:true", "isLarge", 9), because: "no call the run made up reached it" }),
        'a.ts:9 "if:9:true" in isLarge: no call the run made up reached it.',
    );
});
