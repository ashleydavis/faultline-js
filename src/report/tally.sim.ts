// Scenarios for working out what ran.
//
// What this does turns on the copies a run wrote and on what V8 counted over them. Neither is a
// made up value, so these write a copy and hand over counts taken against it.

import fs from "node:fs";
import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import type { ScriptCoverage, Taken } from "../coverage/v8.ts";
import type { FileModel, RunModel } from "../model.ts";
import { Copies, countsFor, countsIn, didRun } from "./tally.ts";

// One copy written into the run's own tree, with the map inside it.
function copy(at: string, text: string): void {
    fs.writeFileSync(
        at,
        ts.transpileModule(text, {
            fileName: at,
            compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, inlineSourceMap: true, inlineSources: true },
        }).outputText,
    );
}

// A run over one file, with a copy of it written.
function over(): RunModel {
    copy("/work/held.mjs", "export function f(a: number): number {\n    if (a > 1) {\n        return 1;\n    }\n    return 0;\n}\n");
    const file: FileModel = {
        file: "held.ts",
        module: "/work/held.mjs",
        functions: [],
        classes: [],
        paths: [{ name: "if:2:true", describe: "the true side of the if", file: "held.ts", line: 2, fn: "f", at: { line: 2, column: 4 } }],
        tests: [],
        properties: [],
    };
    return { root: "/project", work: "/work", files: [file], factories: [], scenarios: [], invariants: [], simModules: {}, unseen: [], seeds: [1], callBudget: 1000 };
}

// A place found in the copy, and one the copy has nowhere for.
export function aPlaceFoundInTheCopy(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const model = over();
    const copies = new Copies(model);
    if (copies.find("held.ts", { line: 2, column: 4 }) === undefined) {
        throw new Error("ThePlaceWasNotFoundInTheCopy");
    }
    // A line the file does not have is nowhere, and a file the run never loaded has no copy.
    if (copies.find("held.ts", { line: 999, column: 0 }) !== undefined) {
        throw new Error("APlaceTheCopyHasNowhereForWasFound");
    }
    if (copies.find("never-measured.ts", { line: 1, column: 0 }) !== undefined) {
        throw new Error("AFileTheRunNeverLoadedHadACopy");
    }
    // The reader is kept, so asking twice parses the map once.
    copies.find("held.ts", { line: 2, column: 4 });
    copies.find("never-measured.ts", { line: 1, column: 0 });
}

// A copy the run has already cleaned up, and one carrying no map.
export function aCopyThatIsNoLongerThere(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const model = over();
    fs.writeFileSync("/work/nomap.mjs", "export const a = 1;\n");
    const held: RunModel = {
        ...model,
        files: [
            { ...model.files[0]!, file: "nomap.ts", module: "/work/nomap.mjs" },
            { ...model.files[0]!, file: "gone.ts", module: "/work/never-written.mjs" },
        ],
    };
    const copies = new Copies(held);
    if (copies.find("nomap.ts", { line: 1, column: 0 }) !== undefined) {
        throw new Error("ACopyCarryingNoMapFoundAPlace");
    }
    // A read the injector fails is a copy the run can no longer read.
    injector.fail("files", "missing");
    copies.find("gone.ts", { line: 1, column: 0 });
}

// Whether one path ran, read from what V8 counted.
export function whetherOnePathRan(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const model = over();
    const copies = new Copies(model);
    const found = copies.find("held.ts", { line: 2, column: 4 })!;
    const script: ScriptCoverage = { url: found.url, functions: [{ functionName: "", ranges: [{ startOffset: 0, endOffset: 9999, count: 3 }] }] };
    const taken: Taken = new Map([[1, new Map([[found.url, script]])]]);

    const counts = countsIn(copies, taken);
    const site = model.files[0]!.paths[0]!;
    if (!didRun(site, counts)) {
        throw new Error("ThePathThatRanWasReadAsUnreached");
    }
    // A path counted against another place ran when its own place ran more often.
    if (didRun({ ...site, against: { line: 2, column: 4 } }, counts)) {
        throw new Error("APathCountedAgainstItselfWasReadAsHavingRun");
    }
    // A run that counted nothing at all.
    countsFor(model, new Map());
    if (didRun(site, countsIn(copies, new Map()))) {
        throw new Error("APathRanInARunThatCountedNothing");
    }
}
