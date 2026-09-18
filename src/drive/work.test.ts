import assert from "node:assert/strict";
import test from "node:test";
import type { FileModel, RunModel } from "../model.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import type { Files } from "../runtime/index.ts";
import type { Unit } from "./protocol.ts";
import { runUnit, type Runtime } from "./work.ts";

// A function with six places its file system could fail and one catch for all of them. Every one of
// the six is a place to explore, and the first of them reaches the catch.
async function readAll(files: Files): Promise<string> {
    try {
        await files.read("/settings.json");
        await files.read("/notes.txt");
        await files.read("/settings.json");
        await files.read("/notes.txt");
        await files.read("/settings.json");
        await files.read("/notes.txt");
        return "read them all";
    }
    catch {
        return "one went wrong";
    }
}

// The one function of the one file, as the reading of a project would have described it.
const held: FunctionInfo = {
    label: "readAll",
    file: "reads.ts",
    async: true,
    line: 1,
    reach: { how: "export", name: "readAll" },
    parameters: [{ name: "files", optional: false, rest: false, recipe: { kind: "effect", effect: "files" } }],
};

// The file it sits in, with the two paths a run would have found in it.
const file: FileModel = {
    file: "reads.ts",
    module: "reads.mjs",
    functions: [held],
    classes: [],
    paths: [
        { name: "readAll:entered", describe: "the body of readAll", file: "reads.ts", line: 1, fn: "readAll", at: { line: 1, column: 0 } },
        { name: "catch:11", describe: "the catch", file: "reads.ts", line: 11, fn: "readAll", at: { line: 11, column: 4 } },
    ],
};

// The run that file belongs to.
const model: RunModel = {
    root: "/root",
    work: "/work",
    files: [file],
    factories: [],
    scenarios: [],
    invariants: [],
    simModules: {},
    unseen: [],
    seeds: [1],
    callBudget: 1000,
};

// One unit that explores the one function.
const unit: Unit = { index: 0, kind: "explore", seed: 1, faulting: false, file: 0, fn: 0 };

// A runtime that loads the function above and remembers what the driving said. `reached` is what a
// runtime supplies when it can read what V8 counted while it is still driving, and leaving it out
// is what a runtime that cannot does.
function runtimeFor(reached?: (file: FileModel) => Promise<Set<string>>): { runtime: Runtime; calls: number[] } {
    const calls: number[] = [];
    const runtime: Runtime = {
        load: async () => ({ readAll }),
        say: (message) => {
            if (message.type === "unit") {
                calls.push(message.calls);
            }
        },
        sendCoverage: async () => {},
        reached,
        ticked: new Set(),
    };
    return { runtime, calls };
}

test("exploring tries every way every place can fail when no runtime can say what has run", async () => {
    const { runtime, calls } = runtimeFor();
    assert.equal(await runUnit(runtime, model, unit, []), true);
    // One call to see where the effects are, then two ways a value can arrive as nothing and five
    // ways each of the six reads can fail.
    assert.equal(calls[0], 1 + 2 + 6 * 5);
});

test("exploring stops once every path of the function has run", async () => {
    const { runtime, calls } = runtimeFor(async () => new Set(["readAll:entered", "catch:11"]));
    assert.equal(await runUnit(runtime, model, unit, []), true);
    // The check comes before each combination, so the one call that found the places is all of it.
    assert.equal(calls[0], 1);
});

test("exploring carries on while a path of the function has not run", async () => {
    let asked = 0;
    const { runtime, calls } = runtimeFor(async () => {
        asked += 1;
        // The catch is reported as reached from the fourth question on, so three combinations run.
        return asked > 3 ? new Set(["readAll:entered", "catch:11"]) : new Set(["readAll:entered"]);
    });
    assert.equal(await runUnit(runtime, model, unit, []), true);
    assert.equal(calls[0], 1 + 3);
});

test("a path an earlier round reached is not one the exploring waits for", async () => {
    const { runtime, calls } = runtimeFor(async () => new Set(["readAll:entered"]));
    runtime.ticked.add("reads.ts:catch:11");
    assert.equal(await runUnit(runtime, model, unit, []), true);
    assert.equal(calls[0], 1);
});
