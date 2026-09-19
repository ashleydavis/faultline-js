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

// A program over several pieces of source, with one of them the file the recipes are read from.
function overFiles(files: Record<string, string>, main: string, runtimeFile: string[] = [], root = "/"): { context: RecipeContext; source: ts.SourceFile } {
    const host: ts.CompilerHost = {
        getSourceFile: (asked, language) => {
            const own = files[asked];
            const text = own ?? ts.sys.readFile(asked);
            return text === undefined ? undefined : ts.createSourceFile(asked, text, language, true);
        },
        getDefaultLibFileName: (asked) => ts.getDefaultLibFilePath(asked),
        writeFile: () => undefined,
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (asked) => asked,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (asked) => files[asked] !== undefined || ts.sys.fileExists(asked),
        readFile: (asked) => files[asked] ?? ts.sys.readFile(asked),
    };
    const program = ts.createProgram(Object.keys(files), { strict: true, target: ts.ScriptTarget.ES2022 }, host);
    return {
        context: { checker: program.getTypeChecker(), runtimeFile, root },
        source: program.getSourceFile(main)!,
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

// The types the reader answers with something of the run's own, and the ones written with no type
// argument at all.
export function theTypesTheRunSuppliesItself(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    // A parameter of one of the runtime module's own types, which the run fills itself. The module
    // is named to the reader as the one file those types may be declared in, so a type of the same
    // name declared anywhere else is an ordinary type.
    const name = "/node_modules/faultline/index.ts";
    const runtime = "export interface Injector { fail(a: string, b: string): void }\nexport interface Checklist { ticked(a: string): boolean }\n";
    const held: Record<string, string> = {
        "/held.ts": 'import type { Checklist, Injector } from "/node_modules/faultline/index.ts";\nexport function f(one: Injector, two: Checklist, three: AbortSignal): void { void one; void two; void three; }',
        [name]: runtime,
    };
    const host: ts.CompilerHost = {
        getSourceFile: (asked, language) => {
            const own = held[asked];
            if (own !== undefined) {
                return ts.createSourceFile(asked, own, language, true);
            }
            const lib = ts.sys.readFile(asked);
            return lib === undefined ? undefined : ts.createSourceFile(asked, lib, language, true);
        },
        getDefaultLibFileName: (asked) => ts.getDefaultLibFilePath(asked),
        writeFile: () => undefined,
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (asked) => asked,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (asked) => held[asked] !== undefined || ts.sys.fileExists(asked),
        readFile: (asked) => held[asked] ?? ts.sys.readFile(asked),
    };
    const program = ts.createProgram(Object.keys(held), { strict: true, target: ts.ScriptTarget.ES2022 }, host);
    const context: RecipeContext = { checker: program.getTypeChecker(), runtimeFile: [name], root: "/" };
    const found: Recipe[] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node)) {
            for (const parameter of node.parameters) {
                found.push(recipeFor(context, context.checker.getTypeAtLocation(parameter), parameter));
            }
        }
        ts.forEachChild(node, walk);
    };
    walk(program.getSourceFile("/held.ts")!);
    if (!found.some((one) => one.kind === "effect")) {
        throw new Error("TheReaderSaidNoneOfThemIsTheRunsOwn");
    }
}

// The collections written with no type argument, and a type name too long to print.
export function theCollectionsWithNothingSaidAboutWhatTheyHold(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = everyRecipe(`
type Long = { a: string } | { b: string } | { c: string } | { d: string } | { e: string } | { f: string } | { g: string } | { h: string } | { i: string } | { j: string } | { k: string } | { l: string };
export function a(one: Map<string, number>, two: Set<string>, three: Array<string>): void { void one; void two; void three; }
export function b(one: unknown[], two: ReadonlyMap<string, number>, three: ReadonlySet<string>): void { void one; void two; void three; }
export function c(one: Long): void { void one; }
export function d(one: symbol, two: () => symbol): void { void one; void two; }
`);
    // An enum with one member, which is that member rather than a union of them.
    everyRecipe("enum One { A = 1 }\nexport function a(one: One): void { void one; }");
    everyRecipe('enum One { A = "a" }\nexport function a(one: One): void { void one; }');
    // A name built out of another, which is none of the types the reader knows.
    everyRecipe("type Named = `held-${string}`;\nexport function a(one: Named): void { void one; }");
    everyRecipe("export function a(one: keyof { a: string; b: number }): void { void one; }");
    // A type declared in the standard library rather than in the project, so the name it is found
    // again by is written from a file outside the root.
    everyRecipe("export function a(one: Promise<string>, two: WeakMap<object, string>): void { void one; void two; }");
    if (found.length < 8) {
        throw new Error("TheReaderFoundTooFewParameters");
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

// The recipe for every parameter of every function in one file of several.
function everyRecipeAcross(files: Record<string, string>, main: string, runtimeFile: string[] = [], root = "/"): Recipe[] {
    const { context, source } = overFiles(files, main, runtimeFile, root);
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

// A project that declares types of its own under the names the runtime already uses.
//
// A project is free to declare `Array`, `Promise`, `Map` or `Set` of its own, and one that does
// means its own type rather than the runtime's. Reading it as the runtime's would build a list
// where a value of the project's type belongs.
export function typesDeclaredUnderTheNamesTheRuntimeUses(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = everyRecipe(`
export {};
interface Array { a: string }
interface Promise { b: string }
interface Map { c: string }
interface Set { d: string }
export function g(one: Array, two: Promise, three: Map, four: Set): void { void one; void two; void three; void four; }
`);
    if (found.length !== 4) {
        throw new Error("TheReaderFoundTheWrongNumberOfParameters");
    }
    if (JSON.stringify(found).includes('"kind":"array"')) {
        throw new Error("TheReaderReadTheProjectsOwnTypeAsTheRuntimes");
    }
}

// An enum with no member, and an intersection whose parts put together hold no property.
export function theTypesWithNoPartToBuildFrom(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    everyRecipe("enum Empty {}\nexport function a(one: Empty): void { void one; }");
    everyRecipe("type Nothing = (() => void) & ((a: number) => string);\nexport function a(one: Nothing): void { void one; }");
}

// A type of the same name declared in three files at once, so a union of them is written out under
// one name three times over.
export function aTypeNameThatSaysOneThingSeveralTimes(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const declared = (member: string): string => `export interface HeldSomethingRatherLongIndeed { ${member}: string }\n`;
    const found = everyRecipeAcross(
        {
            "/a.ts": declared("a"),
            "/b.ts": declared("b"),
            "/c.ts": declared("c"),
            "/held.ts": [
                'import type { HeldSomethingRatherLongIndeed as A } from "/a.ts";',
                'import type { HeldSomethingRatherLongIndeed as B } from "/b.ts";',
                'import type { HeldSomethingRatherLongIndeed as C } from "/c.ts";',
                "export function g(one: A | B | C): void { void one; }",
                "",
            ].join("\n"),
        },
        "/held.ts",
    );
    if (found.length !== 1) {
        throw new Error("TheReaderFoundTheWrongNumberOfParameters");
    }
}

// Types carrying the names the run supplies but declared by the project itself, which the run does
// not supply and reads as ordinary types.
export function theRunsOwnNamesDeclaredByTheProject(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = everyRecipeAcross(
        {
            "/held.ts": [
                "export interface Injector { fail(a: string, b: string): void }",
                "export interface Checklist { ticked(a: string): boolean }",
                "export function g(one: Injector, two: Checklist): void { void one; void two; }",
                "",
            ].join("\n"),
        },
        "/held.ts",
        ["/somewhere-else.ts"],
    );
    if (JSON.stringify(found).includes('"kind":"effect"')) {
        throw new Error("TheReaderSuppliedATypeTheProjectDeclaredItself");
    }
}

// A type declared inside the root of the run, whose key is written relative to that root rather
// than by the path it sits at on this machine.
export function aTypeDeclaredInsideTheRoot(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = everyRecipeAcross(
        { "/project/held.ts": "export interface Held { a: string }\nexport function g(one: Held): void { void one; }\n" },
        "/project/held.ts",
        [],
        "/project",
    );
    if (!JSON.stringify(found).includes('"key":"held.ts#Held"')) {
        throw new Error("TheKeyWasNotWrittenRelativeToTheRoot");
    }
}
