// Scenarios for the list of things to do.
//
// What the list says turns on what the run found, which is a tally rather than a made up value.

import type { Checklist, Injector } from "faultline";
import type { FunctionInfo } from "../discover/functions.ts";
import { checklistFor } from "./checklist.ts";
import type { FileTally, FunctionTally, RunTally } from "./tally.ts";

// One function of a tally, with what the run made of it.
function held(label: string, reach: FunctionInfo["reach"], was: Partial<FunctionTally> = {}): FunctionTally {
    return {
        held: { label, file: "held.ts", line: 1, async: false, parameters: [], reach },
        paths: [{ site: { name: `${label}:entered`, describe: `the body of ${label}`, file: "held.ts", line: 1, fn: label, at: { line: 1, column: 0 } }, ticked: false }],
        ticked: 0,
        calls: 0,
        hung: false,
        ...was,
    };
}

// A tally holding one function of each kind.
function tally(functions: FunctionTally[]): RunTally {
    const file: FileTally = { file: "held.ts", functions, complete: false };
    return { files: [file], total: functions.length, ticked: 0, empty: [] };
}

// Every reason a function has something to do about it.
export function everyReasonAFunctionHasSomethingToDo(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const made = checklistFor(
        tally([
            // A method on a class the file does not export, which is what has to be exported.
            held("NotShown.method", { how: "method", className: "NotShown", classExport: "", name: "method", onClass: false, accessor: "none" }),
            // A function that takes a type the run cannot build.
            held("needsAFactory", { how: "export", name: "needsAFactory" }, { needs: { parameter: "a", typeText: "symbol" }, calls: 3, ticked: 1 }),
            // One that ran past the budget without returning.
            held("neverReturns", { how: "export", name: "neverReturns" }, { hung: true }),
            // One nothing can call directly.
            held("inside", { how: "inside", because: "it is written inside another function, so only that function reaches it" }),
            // One that ran, with a path left.
            held("ran", { how: "export", name: "ran" }, { calls: 4 }),
        ]),
    );
    if (made.todo.length < 4) {
        throw new Error(`TheListSaidTooLittleToDo: ${String(made.todo.length)}`);
    }
    if (!made.todo.some((one) => one.includes("test input factory"))) {
        throw new Error("TheListAskedForNoFactory");
    }
    if (!made.todo.some((one) => one.includes("Export the class"))) {
        throw new Error("TheListAskedForNoClassToBeExported");
    }
    if (!made.todo.some((one) => one.includes("without returning"))) {
        throw new Error("TheListSaidNothingAboutWhatNeverReturned");
    }
    if (made.missed.length === 0) {
        throw new Error("TheListNamedNoPathThatWasMissed");
    }
}

// A tally where everything ran, which has nothing to say.
export function aTallyWhereEverythingRan(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const one = held("ran", { how: "export", name: "ran" }, { calls: 4, ticked: 1 });
    one.paths[0]!.ticked = true;
    const made = checklistFor(tally([one]));
    if (made.todo.length !== 0) {
        throw new Error("TheListHadSomethingToSayAboutARunThatCoveredEverything");
    }
    checklistFor({ files: [], total: 0, ticked: 0, empty: ["nothing.ts"] });
}
