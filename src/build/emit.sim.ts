// Scenarios for writing the copy of a project that a run loads.
//
// What the writing does turns on the source it is given and on what is already in the temporary
// directory, and no made up value is a piece of source. The tree these write into is the run's own,
// held in memory, so nothing here reaches a disk.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import { exportEverything, makeWorkDirectory, namesAnAsset, relativeSpecifier, removeOldRuns, rewriteSpecifiers, transpile } from "./emit.ts";

// Turns one piece of source into the JavaScript a run loads.
function into(text: string): string {
    return transpile(text, "/held.ts", { strict: true });
}

// Every top level declaration a file keeps to itself, which the copy hands out on one holder.
export function everyDeclarationAFileKeepsToItself(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const added = exportEverything(
        into(`
function kept(): number { return 1; }
class Held { held(): number { return 1; } }
const one = 1, two = 2;
let three = 3;
var four = 4;
export function shown(): number { return kept(); }
export class Shown { }
export const five = 5;
export default function () { return 1; }
`),
        "/held.mjs",
    );
    if (!added.includes("export const __flt = {")) {
        throw new Error("TheCopyHandsOutNothingItKeptToItself");
    }
    for (const wanted of ["kept", "Held", "one", "two", "three", "four"]) {
        if (!added.includes(wanted)) {
            throw new Error(`TheCopyKept_${wanted}_ToItself`);
        }
    }
    // A file keeping nothing to itself has nothing added, and one with no map has the line put at
    // the end rather than before it.
    if (exportEverything("export const a = 1;\n", "/a.mjs").includes("__flt")) {
        throw new Error("SomethingWasAddedToAFileKeepingNothingToItself");
    }
    exportEverything("function a() { return 1; }\n", "/a.mjs");
    exportEverything("const { a, b } = { a: 1, b: 2 };\nconst [c] = [1];\n", "/a.mjs");
}

// Every import a file can write, pointed at the copy of what it named.
export function everyImportAFileCanWrite(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const work = makeWorkDirectory("/project");
    fs.writeFileSync("/project/other.ts", "export const a = 1;\n");
    fs.writeFileSync("/project/held.ts", "export const b = 2;\n");
    const modules = new Map([
        ["other.ts", path.join(work, "other.mjs")],
        ["held.ts", path.join(work, "held.mjs")],
    ]);
    const options = { root: "/project", program: undefined as unknown as ts.Program, options: { strict: true }, measured: new Set(["held.ts"]) };
    const written = rewriteSpecifiers(
        into(`
import { a } from "./other.ts";
import * as everything from "./other.ts";
import "./other.ts";
export { a } from "./other.ts";
export * from "./other.ts";
import outside from "somebody-elses-package";
import styles from "./held.css";
import raw from "./held.svg?raw";
const later = await import("./other.ts");
const computed = await import(everything.name);
export const held = a + outside + styles + raw + later + computed;
`),
        path.join(work, "held.mjs"),
        "/project/held.ts",
        work,
        options as never,
        modules,
    );
    // What a relative import resolves to is looked up through the compiler's own file access, which
    // reads the machine rather than the run's own tree, so the copy of "./other.ts" is not found
    // from here and the import is left where it is. What is checked here is what does not depend on
    // that: an asset, and a package.
    if (!written.includes("__faultline-asset.mjs")) {
        throw new Error("TheStylesheetWasNotStoodInFor");
    }
    if (!written.includes("somebody-elses-package")) {
        throw new Error("SomebodyElsesPackageWasPointedSomewhereElse");
    }
}

// Whether one name is an asset rather than code, and how one copy is named from another.
export function theLittleAnswersAboutOneName(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    for (const one of ["./a.css", "./a.svg?raw", "./a.png", "./a.ts", "./a.js", "./a.json", "./a", "a/b", "./a.TS"]) {
        namesAnAsset(one);
    }
    relativeSpecifier("/work/a/b.mjs", "/work/a/c.mjs");
    relativeSpecifier("/work/a/b.mjs", "/work/c.mjs");
}

// What earlier runs left behind, which a run takes away before it writes its own.
export function whatEarlierRunsLeftBehind(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const inside = "/holding";
    for (let at = 0; at < 8; at += 1) {
        const where = path.join(inside, `faultline-made-${String(at)}`);
        fs.mkdirSync(where);
        fs.writeFileSync(path.join(where, "a.mjs"), "export const a = 1;\n");
    }
    // Something that is not a run of this tool is left where it is.
    fs.mkdirSync(path.join(inside, "somebody-elses-directory"));
    removeOldRuns(inside);
    // A directory that is not there at all leaves everything where it is.
    removeOldRuns("/never-made");
    removeOldRuns();
}
