import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { literalsIn } from "./literals.ts";

// Reads one piece of source the way a run reads a file, so the checker is there to resolve a name.
function read(text: string): { values: (string | number | boolean)[]; properties: string[] } {
    const source = ts.createSourceFile("a.ts", text, ts.ScriptTarget.Latest, true);
    const host: ts.CompilerHost = {
        getSourceFile: (name) => (name === "a.ts" ? source : undefined),
        getDefaultLibFileName: () => "lib.d.ts",
        writeFile: () => undefined,
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (name) => name === "a.ts",
        readFile: (name) => (name === "a.ts" ? text : undefined),
    };
    const program = ts.createProgram(["a.ts"], {}, host);
    return literalsIn(program.getTypeChecker(), program.getSourceFile("a.ts")!);
}

test("a string a comparison tests against is read out of the file", () => {
    assert.ok(read('export function f(x: string) { return x === "the-one-word"; }').values.includes("the-one-word"));
});

test("a number a comparison tests against is read out of the file", () => {
    assert.ok(read("export function f(x: number) { return x > 42; }").values.includes(42));
});

test("a value a case tests against is read out of the file", () => {
    assert.ok(read('export function f(x: string) { switch (x) { case "red": return 1; } return 0; }').values.includes("red"));
});

test("what a call asks about a value is read out of the file", () => {
    assert.ok(read('export function f(x: string) { return x.startsWith("PNG"); }').values.includes("PNG"));
});

test("a name standing for one value is read as that value", () => {
    // A file switching on flags names them rather than writing the numbers, and the numbers are
    // what the branch turns on.
    const held = read("const enum Flag { On = 8, Off = 16 }\nexport function f(x: number) { return (x & Flag.On) !== 0; }");
    assert.ok(held.values.includes(8), JSON.stringify(held.values));
});

test("a property the file reads is written down, so a stand-in answers it", () => {
    assert.ok(read("export function f(x: { held: number }) { return x.held; }").properties.includes("held"));
});

test("a file testing against nothing hands over nothing", () => {
    assert.deepEqual(read("export function f(x: number) { return x; }").values, []);
});
