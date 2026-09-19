// Scenarios for reading what V8 says ran.
//
// A source map is a piece of data no made up value builds, so these build one with the compiler and
// hand it over.

import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import { inlineMapOf, Offsets, Places } from "./v8.ts";

// One file transpiled the way a run transpiles the copies, with the map inside it.
function transpiled(text: string): { generated: string; map: string } {
    const generated = ts.transpileModule(text, {
        fileName: "/held.ts",
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, inlineSourceMap: true, inlineSources: true },
    }).outputText;
    const map = inlineMapOf(generated);
    if (map === undefined) {
        throw new Error("TheTranspileWroteNoMap");
    }
    return { generated, map };
}

// A place in the file somebody wrote, found in the file that ran.
export function aPlaceFoundInTheFileThatRan(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const { generated, map } = transpiled("export function f(a: number): number {\n    if (a > 1) {\n        return 1;\n    }\n    return 0;\n}\n");
    const places = new Places(map, generated);
    const inside = places.generatedOffsetOf(2, 4);
    if (inside < 0) {
        throw new Error("ThePlaceWasNotFoundInTheFileThatRan");
    }
    if (places.generatedOffsetOf(1, 0) < 0) {
        throw new Error("TheStartOfTheFileWasNotFound");
    }
    // A line the file does not have is nowhere.
    places.generatedOffsetOf(999, 0);
}

// A map naming no source at all, which is what a transpile that wrote one without them gives.
export function aMapNamingNoSource(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const empty = new Places(JSON.stringify({ version: 3, sources: [], names: [], mappings: "" }), "x\n");
    if (empty.generatedOffsetOf(1, 0) !== -1) {
        throw new Error("AMapNamingNoSourceFoundAPlace");
    }
    const nulled = new Places(JSON.stringify({ version: 3, sources: [null], names: [], mappings: "" }), "x\n");
    nulled.generatedOffsetOf(1, 0);
}

// Turning a line and a column into an offset, over text of every shape.
export function turningAPositionIntoAnOffset(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const held = new Offsets("ab\ncd\n\nef");
    if (held.offsetOf(1, 0) !== 0 || held.offsetOf(2, 1) !== 4 || held.offsetOf(4, 0) !== 7) {
        throw new Error("TheOffsetsWereNotWhereTheLinesAre");
    }
    if (held.offsetOf(99, 0) !== -1) {
        throw new Error("ALineTheTextDoesNotHaveWasFound");
    }
    new Offsets("").offsetOf(1, 0);
}

// A file carrying a map inside it, and one carrying none.
export function whetherAFileCarriesAMap(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (inlineMapOf("x\n") !== undefined) {
        throw new Error("AFileWithNoMapHandedOverOne");
    }
    if (inlineMapOf(transpiled("export const a = 1;\n").generated) === undefined) {
        throw new Error("AFileWithAMapHandedOverNone");
    }
}
