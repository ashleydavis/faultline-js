// Scenarios for reading a type and saying how to build values of it.
//
// What a recipe reader does turns on the type it is given, and no made up value is a type. These
// build a program over source text held in memory and hand it the types in it.

import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import { recipeFor, typeKeyOf, type Recipe, type RecipeContext } from "./recipes.ts";

// A program over one piece of source. The source itself is held in memory, and the standard library
// is read through the compiler's own file access rather than through `node:fs`, because a run
// measuring this repository replaces `node:fs` with a tree of its own and the library is not in it.
function over(text: string): { context: RecipeContext; source: ts.SourceFile } {
    const name = "/held.ts";
    const options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"] };
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    const host: ts.CompilerHost = {
        getSourceFile: (asked, language) => {
            if (asked === name) {
                return source;
            }
            const held = ts.sys.readFile(asked);
            return held === undefined ? undefined : ts.createSourceFile(asked, held, language, true);
        },
        getDefaultLibFileName: (asked) => ts.getDefaultLibFilePath(asked),
        writeFile: () => undefined,
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (asked) => asked,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (asked) => asked === name || ts.sys.fileExists(asked),
        readFile: (asked) => (asked === name ? text : ts.sys.readFile(asked)),
    };
    const program = ts.createProgram([name], options, host);
    return {
        context: { checker: program.getTypeChecker(), runtimeFile: [], root: "/" },
        source: program.getSourceFile(name)!,
    };
}

// The recipe for every parameter of every function in one piece of source.
function everyRecipe(text: string): Recipe[] {
    const { context, source } = over(text);
    const out: Recipe[] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node)) {
            for (const parameter of node.parameters) {
                out.push(recipeFor(context, context.checker.getTypeAtLocation(parameter), parameter));
            }
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    return out;
}

// Every kind of type the reader has something to say about.
export function everyKindOfType(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = everyRecipe(`
enum Numbered { A = 1, B = 2 }
enum Worded { A = "a", B = "b" }
interface Held { name: string; at?: number; [key: string]: unknown }
type Either = { how: "one"; a: string } | { how: "two"; b: number };
type Both = { a: string } & { b: number };
type Deep = { held: Deep | null };
export function a(one: string, two: number, three: boolean, four: bigint, five: symbol): void { void one; void two; void three; void four; void five; }
export function b(one: null, two: undefined, three: void, four: never, five: unknown, six: any): void { void one; void two; void three; void four; void five; void six; }
export function c(one: "kept", two: 7, three: true, four: false): void { void one; void two; void three; void four; }
export function d(one: string[], two: readonly number[], three: [string, number], four: Map<string, number>, five: Set<string>): void { void one; void two; void three; void four; void five; }
export function e(one: Date, two: RegExp, three: URL, four: Uint8Array, five: Error, six: Promise<string>): void { void one; void two; void three; void four; void five; void six; }
export function f(one: Numbered, two: Worded, three: Held, four: Either, five: Both, six: Deep): void { void one; void two; void three; void four; void five; void six; }
export function g(one: () => number, two: (a: string) => void, three: new () => Held): void { void one; void two; void three; }
export function h<T>(one: T, two: T[]): void { void one; void two; }
export function i<T extends string>(one: T): void { void one; }
export function j(one?: string, ...rest: number[]): void { void one; void rest; }
export function k(one: Record<string, number>, two: Partial<Held>, three: Readonly<Held>): void { void one; void two; void three; }
export function l(one: string | undefined, two: string | null, three: 1 | 2 | 3): void { void one; void two; void three; }
`);
    const kinds = new Set(found.map((one) => one.kind));
    for (const wanted of ["string", "number", "boolean", "bigint", "null", "undefined", "literal", "union", "array", "tuple", "map", "set", "date", "regexp", "url", "bytes", "error", "promise", "function", "object", "any"]) {
        if (!kinds.has(wanted as Recipe["kind"])) {
            throw new Error(`TheReaderSaidNothingIsA_${wanted}`);
        }
    }
    if (JSON.stringify(found).includes('"kind":"unknown"')) {
        // Only a symbol is left as a type the run cannot build, and it is named as such.
        if (!JSON.stringify(found).includes('"text":"symbol"')) {
            throw new Error("TheReaderCouldNotBuildSomethingItShouldHave");
        }
    }
}

// A type that refers to itself, which is what the cap on how deep a type is read is for.
export function aTypeThatRefersToItself(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = everyRecipe("interface Node { held: Node; also: Node[]; maybe?: Node }\nexport function f(one: Node): void { void one; }");
    if (found.length !== 1) {
        throw new Error("TheReaderFoundTheWrongNumberOfParameters");
    }
}

// The name a type is found again by, which is what a test input factory is looked up under.
export function theNameATypeIsFoundAgainBy(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const { context, source } = over("export interface Held { a: string }\nexport type Named = { b: number };\nexport function f(one: Held, two: Named, three: string): void { void one; void two; void three; }");
    const walk = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node)) {
            for (const parameter of node.parameters) {
                typeKeyOf(context, context.checker.getTypeAtLocation(parameter));
            }
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
}
