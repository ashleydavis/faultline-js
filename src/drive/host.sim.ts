// Scenarios for putting together what the driving said.
//
// What these answer turns on a run and on what V8 counted over it, neither of which is a made up
// value.

import type { Checklist, Injector } from "faultline";
import type { FileModel, RunModel } from "../model.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import { driverBeside, startupBudget, tickedNames, unreachedFunctions } from "./host.ts";
import type { Counts } from "../report/tally.ts";

// One function of the model.
function fn(label: string): FunctionInfo {
    return { label, file: "held.ts", line: 1, async: false, parameters: [], reach: { how: "export", name: label } };
}

// A run over one file with two functions, one path each.
const file: FileModel = {
    file: "held.ts",
    module: "/work/held.mjs",
    functions: [fn("ran"), fn("didNot")],
    classes: [],
    paths: [
        { name: "ran:entered", describe: "the body of ran", file: "held.ts", line: 1, fn: "ran", at: { line: 1, column: 0 } },
        { name: "didNot:entered", describe: "the body of didNot", file: "held.ts", line: 2, fn: "didNot", at: { line: 2, column: 0 } },
    ],
    tests: [],
    properties: [],
};

const model: RunModel = {
    root: "/project",
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

// Counts saying the first path ran and the second did not.
const counts: Counts = { at: (_file, place) => (place.line === 1 ? 3 : 0) };

// What a run reached and what it has left, which is what the next round drives.
export function whatARunReachedAndWhatIsLeft(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const ticked = tickedNames(model, counts);
    if (!ticked.includes("held.ts:ran:entered")) {
        throw new Error("TheRunDidNotSayThePathThatRanHadRun");
    }
    if (ticked.includes("held.ts:didNot:entered")) {
        throw new Error("TheRunSaidAPathRanThatDidNot");
    }
    const left = unreachedFunctions(model, counts);
    if (!left.has("held.ts#didNot")) {
        throw new Error("TheRunDidNotSayWhichFunctionHasAPathLeft");
    }
    if (left.has("held.ts#ran")) {
        throw new Error("TheRunSaidAFunctionHasAPathLeftWhenItDoesNot");
    }
    // A run where everything ran, and one where nothing did.
    unreachedFunctions(model, { at: () => 1 });
    tickedNames(model, { at: () => 0 });
}

// How long the driver is allowed to load a project before it says anything, which is longer than
// one call is allowed.
export function howLongStartingUpIsAllowed(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (startupBudget(1000) <= 1000) {
        throw new Error("StartingUpWasAllowedNoLongerThanOneCall");
    }
    if (startupBudget(60000) !== 60000) {
        throw new Error("ABudgetLongerThanTheFloorWasShortened");
    }
}

// Where the driver sits beside the tool, which is the TypeScript in a clone and the built
// JavaScript in an installed copy.
export function whereTheDriverSits(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (driverBeside().length === 0) {
        throw new Error("TheDriverWasNotFoundBesideTheTool");
    }
}
