// Scenarios for putting together what the driving said.
//
// What these answer turns on a run and on what V8 counted over it, neither of which is a made up
// value.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Checklist, Injector } from "faultline";
import type { FileModel, RunModel } from "../model.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import { drive, driverBeside, startupBudget, tickedNames, unreachedFunctions } from "./host.ts";
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

// Puts a driver where this copy of the tool looks for one, and says where that is.
//
// The driver sits beside the module that starts it. A copy of the tool has no driver beside it, so
// one is written there, and the one written never runs: the module that forks is replaced while a
// run is measuring.
function driverWritten(): string {
    const where = fileURLToPath(new URL("./child.ts", import.meta.url));
    fs.writeFileSync(where, "");
    return where;
}

// Where the driver sits beside the tool, and what is said when it sits nowhere.
export function whereTheDriverSits(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const where = driverWritten();
    if (driverBeside() !== where) {
        throw new Error("TheDriverWasNotFoundWhereItWasPut");
    }

    fs.rmSync(where);
    let said = "";
    try {
        driverBeside();
    }
    catch (thrown) {
        said = (thrown as Error).message;
    }
    if (!said.includes("not found")) {
        throw new Error("ACopyWithNoDriverBesideItDidNotSaySo");
    }
}

// One list of work driven from end to end, over a driver that answers the way a run makes up.
export async function oneListOfWorkDriven(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    driverWritten();
    let told = 0;
    const result = await drive(model, "/work/model.json", () => {
        told += 1;
    });
    if (result.rounds < 1) {
        throw new Error("TheDrivingCameBackHavingDrivenNoRound");
    }
    void told;
}

// A driver that will not start at all, which is what a machine with no room for a process does.
export async function aDriverThatWillNotStart(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    driverWritten();
    injector.fail("process", "missing");
    const result = await drive(model, "/work/model.json", () => undefined);
    if (result.broke === undefined) {
        throw new Error("ADriverThatWouldNotStartWasNotReported");
    }
}
