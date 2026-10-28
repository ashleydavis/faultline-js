// Tests the reading of a parameter's type into a recipe: how each kind of type is built, which
// types carry the key a value factory is found by, how a type that holds itself stops and how a
// type the run cannot build is named. Each test writes a small project in memory, reads the type of
// the first parameter of a function called `f` through a real type checker and checks the recipe.

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import { projectRoot } from "../lib/fake-files.test.ts";
import { fixture } from "./fixture.test.ts";
import { isLibraryType, leafKey, libraryKey, recipeFor, recipeUnderWrittenAlias, typeKeyOf, writtenAliasKey } from "./recipes.ts";
import type { Recipe, RecipeContext } from "./recipes.ts";

// The first parameter of the function called `f` at the top of `source`, which every file these
// tests write declares.
export function parameterOfF(source: ts.SourceFile): ts.ParameterDeclaration {
    const declaration = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "f");
    assert.ok(declaration !== undefined, "The file declares no function called f.");
    const parameter = declaration.parameters[0];
    assert.ok(parameter !== undefined, "The function f takes no parameter.");
    return parameter;
}

// The recipe for the first parameter of the function called `f` written in `file`, one of the
// files the project is built from.
export async function recipeIn(files: Record<string, string>, file: string): Promise<Recipe> {
    const made = await fixture(files);
    const parameter = parameterOfF(made.source(file));
    return recipeFor(made.context, made.built.checker.getTypeAtLocation(parameter), parameter);
}

// The recipe for the first parameter of the function called `f` in a file written on the spot.
export async function recipeOf(text: string): Promise<Recipe> {
    return recipeIn({
        "a.ts": text,
    }, "a.ts");
}

// The key `typeKeyOf` gives the type of the first parameter of the function called `f`, read with
// every key written relative to `root`.
export async function keyOfParameter(text: string, root: string): Promise<string | undefined> {
    const made = await fixture({
        "a.ts": text,
    });
    const context: RecipeContext = {
        checker: made.context.checker,
        simTypesFile: made.context.simTypesFile,
        root,
    };
    return typeKeyOf(context, made.built.checker.getTypeAtLocation(parameterOfF(made.source("a.ts"))));
}

//
// The type of the first parameter of the function called `f` in `a.ts`, one of `files`, with the
// context it was read in.
//
export interface IParameterType {
    //
    // What the type was read with, keys written relative to the fixture's root.
    //
    context: RecipeContext;

    //
    // The parameter's type.
    //
    type: ts.Type;
}

//
// Reads the type of the first parameter of `f` in `a.ts`, so a test can ask about a type declared
// in another of the files.
//
export async function readParameterType(files: Record<string, string>): Promise<IParameterType> {
    const made = await fixture(files);
    const type = made.built.checker.getTypeAtLocation(parameterOfF(made.source("a.ts")));
    assert.ok(type !== undefined);
    return {
        context: made.context,
        type,
    };
}

//
// A declaration file declaring a generic class whose method returns a deeper type of itself, as a
// zod schema's `.optional()` does, so reading inside it would never end.
//
export const deeperBox = "export declare class Box<T> { value: T; wrap(): Box<Box<T>>; }";

describe("parameterOfF", () => {
    test("the first parameter of f is found", async () => {
        assert.equal(parameterOfF((await fixture({
            "a.ts": "export function g(b: number) { return b; }\nexport function f(a: string, c: number) { return a; }",
        })).source("a.ts")).name.getText(), "a");
    });

    test("a file with no f, or an f with no parameter, is a programmer error", async () => {
        const made = await fixture({
            "a.ts": "export function g(b: number) { return b; }",
            "b.ts": "export function f() {}",
        });
        assert.throws(() => parameterOfF(made.source("a.ts")), /no function called f/);
        assert.throws(() => parameterOfF(made.source("b.ts")), /takes no parameter/);
    });
});

describe("recipeIn", () => {
    test("the parameter is read from the file named, among the others", async () => {
        assert.equal((await recipeIn({
            "a.ts": "export function f(a: string) { return a; }",
            "b.ts": "export function f(a: number) { return a; }",
        }, "b.ts")).kind, "number");
    });
});

describe("keyOfParameter", () => {
    test("a type declared under the root carries a key relative to the root", async () => {
        assert.equal(await keyOfParameter("export interface Thing { x: number }\nexport function f(a: Thing) { return a; }", projectRoot), "a.ts#Thing");
    });
});

describe("recipeFor", () => {
    test("each primitive is read as itself", async () => {
        assert.equal((await recipeOf("export function f(a: string) { return a; }")).kind, "string");
        assert.equal((await recipeOf("export function f(a: number) { return a; }")).kind, "number");
        assert.equal((await recipeOf("export function f(a: boolean) { return a; }")).kind, "boolean");
        assert.equal((await recipeOf("export function f(a: bigint) { return a; }")).kind, "bigint");
        assert.equal((await recipeOf("export function f(a: null) { return a; }")).kind, "null");
        assert.equal((await recipeOf("export function f(a: undefined) { return a; }")).kind, "undefined");
        assert.equal((await recipeOf("export function f(a: any) { return a; }")).kind, "any");
        assert.equal((await recipeOf("export function f(a: unknown) { return a; }")).kind, "any");
    });

    test("a literal is read as the one value it is", async () => {
        assert.deepEqual(await recipeOf('export function f(a: "x") { return a; }'), {
            kind: "literal",
            value: "x",
        });
        assert.deepEqual(await recipeOf("export function f(a: 7) { return a; }"), {
            kind: "literal",
            value: 7,
        });
        assert.deepEqual(await recipeOf("export function f(a: true) { return a; }"), {
            kind: "literal",
            value: true,
        });
    });

    test("a union is read as every side of it", async () => {
        const recipe = await recipeOf('export function f(a: "x" | "y") { return a; }');
        assert.ok(recipe.kind === "union");
        assert.equal(recipe.options.length, 2);
    });

    test("an optional parameter reads as the type it names and is left out by the caller instead", async () => {
        assert.equal((await recipeOf("export function f(a?: string) { return a; }")).kind, "string");
    });

    test("a type written out where it is used carries no key, so no value factory is asked for", async () => {
        assert.equal((await recipeOf("export function f(a: { x: number }) { return a; }")).kind, "object");
    });

    test("an array is read as a list of its element", async () => {
        const recipe = await recipeOf("export function f(a: number[]) { return a; }");
        assert.ok(recipe.kind === "array");
        assert.equal(recipe.element.kind, "number");
    });

    test("a tuple is read element by element", async () => {
        const recipe = await recipeOf("export function f(a: [string, number]) { return a; }");
        assert.ok(recipe.kind === "tuple");
        assert.deepEqual(recipe.elements.map((element) => element.kind), ["string", "number"]);
    });

    test("a map and a set are read with what they hold", async () => {
        assert.equal((await recipeOf("export function f(a: Map<string, number>) { return a; }")).kind, "map");
        assert.equal((await recipeOf("export function f(a: Set<string>) { return a; }")).kind, "set");
    });

    test("the types every runtime already has are each read as themselves", async () => {
        assert.equal((await recipeOf("export function f(a: Date) { return a; }")).kind, "date");
        assert.equal((await recipeOf("export function f(a: RegExp) { return a; }")).kind, "regexp");
        assert.equal((await recipeOf("export function f(a: URL) { return a; }")).kind, "url");
        assert.equal((await recipeOf("export function f(a: Uint8Array) { return a; }")).kind, "bytes");
        assert.equal((await recipeOf("export function f(a: Error) { return a; }")).kind, "error");
    });

    test("bytes and errors keep the name of the runtime type they are", async () => {
        assert.deepEqual(await recipeOf("export function f(a: Uint8Array) { return a; }"), {
            kind: "bytes",
            name: "Uint8Array",
        });
        assert.deepEqual(await recipeOf("export function f(a: ArrayBuffer) { return a; }"), {
            kind: "bytes",
            name: "ArrayBuffer",
        });
        assert.deepEqual(await recipeOf("export function f(a: TypeError) { return a; }"), {
            kind: "error",
            name: "TypeError",
        });
        assert.deepEqual(await recipeOf("export function f(a: RangeError) { return a; }"), {
            kind: "error",
            name: "RangeError",
        });
    });

    test("a promise is read with what it resolves to", async () => {
        const recipe = await recipeOf("export function f(a: Promise<string>) { return a; }");
        assert.ok(recipe.kind === "promise");
        assert.equal(recipe.value.kind, "string");
    });

    test("a function type is read with what it returns", async () => {
        const recipe = await recipeOf("export function f(a: () => number) { return a; }");
        assert.ok(recipe.kind === "function");
        assert.equal(recipe.returns.kind, "number");
    });

    test("an object type is read property by property", async () => {
        const recipe = await recipeOf("export function f(a: { x: number; y?: string }) { return a; }");
        assert.ok(recipe.kind === "object");
        assert.deepEqual(recipe.properties.map((property) => property.name), ["x", "y"]);
        assert.equal(recipe.properties[1]?.optional, true);
    });

    test("a type declared in the project carries the key a value factory is found by", async () => {
        const recipe = await recipeOf("export interface Thing { x: number }\nexport function f(a: Thing) { return a; }");
        assert.ok(recipe.kind === "named");
        assert.equal(recipe.key, "a.ts#Thing");
        assert.equal(recipe.name, "Thing");
    });

    test("a named type still carries the properties it has, so a value is built without a value factory", async () => {
        const recipe = await recipeOf("export interface Thing { x: number }\nexport function f(a: Thing) { return a; }");
        assert.ok(recipe.kind === "named");
        assert.equal(recipe.structural.kind, "object");
    });

    test("an index signature is read as well as the properties beside it", async () => {
        const recipe = await recipeOf("export function f(a: Record<string, number>) { return a; }");
        assert.ok(recipe.kind === "object");
        assert.equal(recipe.index?.kind, "number");
    });

    test("a type parameter with no constraint stands for anything", async () => {
        assert.equal((await recipeOf("export function f<T>(a: T) { return a; }")).kind, "any");
    });

    test("a type parameter with a constraint is read as the constraint", async () => {
        assert.equal((await recipeOf("export function f<T extends string>(a: T) { return a; }")).kind, "string");
    });

    test("a type that refers to itself stops rather than going on for ever", async () => {
        assert.equal((await recipeOf("export interface Node { next: Node; value: number }\nexport function f(a: Node) { return a; }")).kind, "named");
    });

    test("a symbol is read as something no value can be built for", async () => {
        assert.equal((await recipeOf("export function f(a: symbol) { return a; }")).kind, "unknown");
    });

    test("a primitive nested deeply is still read as that primitive", async () => {
        // A string below many levels of the project's own types is still a string the run can
        // build, so no value factory is asked for it.
        const recipe = await recipeOf("export interface A { b: B }\ninterface B { c: C }\ninterface C { d: D }\ninterface D { e: E }\ninterface E { f: F }\ninterface F { g: G }\ninterface G { h: H }\ninterface H { held: string }\nexport function f(a: A) { void a; }");
        assert.ok(!JSON.stringify(recipe).includes("\"unknown\""), JSON.stringify(recipe));
    });

    test("a type that refers to itself stops with a value the run can build", async () => {
        const held = await recipeOf("export interface Node { held: Node | null }\nexport function f(n: Node) { void n; }");
        assert.ok(!JSON.stringify(held).includes('"unknown"'), JSON.stringify(held).slice(0, 300));
    });

    test("an enum of numbers is read as a number", async () => {
        assert.deepEqual(await recipeOf("enum Kind { A = 1, B = 2 }\nexport function f(k: Kind) { void k; }"), {
            kind: "number",
        });
    });

    test("an enum of strings is read as a string", async () => {
        assert.deepEqual(await recipeOf('enum Kind { A = "a", B = "b" }\nexport function f(k: Kind) { void k; }'), {
            kind: "string",
        });
    });

    test("a wide type is read whole, however many properties it has", async () => {
        // Faultline never cuts a reading short to be faster, so the last property of a type with more
        // properties than any fixed number is read as what it is.
        const fields = Array.from({
            length: 400,
        }, (_unused, index) => `p${index}: string;`).join(" ");
        const recipe = await recipeOf(`export interface Wide { ${fields} }\nexport function f(a: Wide) { return a; }`);
        assert.ok(recipe.kind === "named");
        assert.ok(recipe.structural.kind === "object");
        assert.equal(recipe.structural.properties.find((property) => property.name === "p399")?.recipe.kind, "string");
    });

    test("a type deeper than any fixed number of levels is read to the bottom", async () => {
        const levels = Array.from({
            length: 12,
        }, (_unused, index) => `interface L${index} { next: L${index + 1} }`).join("\n");
        const recipe = await recipeOf(`${levels}\ninterface L12 { held: number }\nexport function f(a: L0) { return a; }`);
        assert.ok(JSON.stringify(recipe).includes('"held"'), JSON.stringify(recipe).slice(0, 300));
    });

    test("a generic type that nests itself one level deeper each time stops", async () => {
        assert.equal((await recipeOf("export interface Box<T> { held: T; inner: Box<Box<T>> }\nexport function f(a: Box<number>) { return a; }")).kind, "named");
    });

    test("an array of arrays is read as two arrays, because only a type of the project's own can hold itself", async () => {
        const recipe = await recipeOf("export function f(a: number[][]) { return a; }");
        assert.ok(recipe.kind === "array");
        assert.ok(recipe.element.kind === "array");
        assert.equal(recipe.element.element.kind, "number");
    });

    test("a parameter that can hold no value is read as never", async () => {
        assert.deepEqual(await recipeOf("export function f(a: never) { return a; }"), {
            kind: "never",
        });
    });

    test("a type two properties share is read once and the one reading is given to both", async () => {
        const recipe = await recipeOf("export interface Thing { x: number }\nexport function f(a: { one: Thing; two: Thing }) { return a; }");
        assert.ok(recipe.kind === "object");
        assert.equal(recipe.properties.length, 2);
        assert.equal(recipe.properties[0]?.recipe, recipe.properties[1]?.recipe);
    });

    test("an intersection is read as the properties of every part put together", async () => {
        const recipe = await recipeOf("export interface A { x: number }\nexport interface B { y: string }\nexport function f(a: A & B) { return a; }");
        assert.ok(recipe.kind === "object");
        assert.deepEqual(recipe.properties.map((property) => property.name), ["x", "y"]);
    });

    test("an intersection with no properties is read as something no value can be built for, under its name", async () => {
        assert.deepEqual(await recipeOf("export function f<T, U>(a: T & U) { return a; }"), {
            kind: "unknown",
            text: "T & U",
        });
    });

    test("a class to be built with new is read as something no value can be built for, under its name", async () => {
        assert.deepEqual(await recipeOf("export function f(a: new () => object) { return a; }"), {
            kind: "unknown",
            text: "new () => object",
        });
    });

    test("a type name longer than a line is cut short and marked as cut", async () => {
        const fields = Array.from({
            length: 20,
        }, (_unused, index) => `field${index}: string;`).join(" ");
        const recipe = await recipeOf(`export function f(a: new () => { ${fields} }) { return a; }`);
        assert.ok(recipe.kind === "unknown");
        assert.equal(recipe.text.length, 83);
        assert.ok(recipe.text.startsWith("new () => { field0: string;"), recipe.text);
        assert.ok(recipe.text.endsWith("..."), recipe.text);
    });

    test("a template literal type is read as something no value can be built for, under its name", async () => {
        assert.deepEqual(await recipeOf("export function f(a: `id-${string}`) { return a; }"), {
            kind: "unknown",
            text: "`id-${string}`",
        });
    });

    test("a parameter in a sim file whose type has no name of its own is read like any other", async () => {
        assert.deepEqual(await recipeIn({
            "a.sim.ts": "export function f(a: `id-${string}`) { return a; }",
        }, "a.sim.ts"), {
            kind: "unknown",
            text: "`id-${string}`",
        });
    });

    test("a parameter in a sim file whose type is not a context the run supplies is read like any other", async () => {
        assert.deepEqual(await recipeIn({
            "a.sim.ts": "export function f(a: Date) { return a; }",
        }, "a.sim.ts"), {
            kind: "date",
        });
    });

    test("an abort signal is supplied by the run, because what it carries is whether the run gave up", async () => {
        assert.deepEqual(await recipeOf("export function f(a: AbortSignal) { return a; }"), {
            kind: "effect",
            effect: "signal",
        });
    });

    test("a parameter of type void is read as void", async () => {
        assert.deepEqual(await recipeOf("export function f(a: void) { return a; }"), {
            kind: "void",
        });
    });

    test("a type whose name was declared in no file is read for the properties it has", async () => {
        // The project declares one global of its own and no library or package types, so what the
        // globals hold is small enough to read whole.
        const recipe = await recipeIn({
            "a.ts": "export function f(a: typeof globalThis) { return a; }",
            "globals.d.ts": "declare var counted: number;",
            "tsconfig.json": '{ "compilerOptions": { "noLib": true, "types": [] } }',
        }, "a.ts");
        assert.ok(recipe.kind === "object");
        assert.ok(recipe.properties.some((property) => property.name === "counted"));
    });

    test("a library type is not read inside and is asked for by its name", async () => {
        const recipe = await recipeOf("export function f(a: HTMLElement) { return a; }");
        assert.ok(recipe.kind === "named");
        assert.deepEqual(recipe.structural, {
            kind: "unknown",
            text: "HTMLElement",
        });
    });

    test("a library type that can be called and has properties of its own, as an Express app has, is a library type", async () => {
        const recipe = await recipeIn({
            "a.ts": 'import type { App } from "./app";\nexport function f(a: App) { return a; }',
            "app.d.ts": "export interface App {\n    (request: string): void;\n    listen(port: number): void;\n}\n",
        }, "a.ts");
        assert.deepEqual(recipe, {
            kind: "named",
            key: "app.d.ts#App",
            name: "App",
            structural: {
                kind: "unknown",
                text: "App",
            },
        });
    });

    test("a library type with nothing in it is a library type", async () => {
        const recipe = await recipeIn({
            "a.ts": 'import type { Marker } from "./marker";\nexport function f(a: Marker) { return a; }',
            "marker.d.ts": "export interface Marker {}\n",
        }, "a.ts");
        assert.deepEqual(recipe, {
            kind: "named",
            key: "marker.d.ts#Marker",
            name: "Marker",
            structural: {
                kind: "unknown",
                text: "Marker",
            },
        });
    });

    test("a library type that is a call signature and nothing more is a function", async () => {
        const recipe = await recipeIn({
            "a.ts": 'import type { Next } from "./next";\nexport function f(a: Next) { return a; }',
            "next.d.ts": "export interface Next {\n    (error: string): number;\n}\n",
        }, "a.ts");
        assert.deepEqual(recipe, {
            kind: "function",
            returns: {
                kind: "number",
            },
        });
    });

    test("a library type whose method returns a deeper type of itself is read at once", async () => {
        const recipe = await recipeIn({
            "a.ts": 'import type { Box } from "./box";\nexport function f(a: Box<number>) { return a; }',
            "box.d.ts": deeperBox,
        }, "a.ts");
        assert.deepEqual(recipe, {
            kind: "named",
            key: "box.d.ts#Box",
            name: "Box",
            structural: {
                kind: "unknown",
                text: "Box",
            },
        });
    });

    test("a project's own type holding a library type holds it unread", async () => {
        const recipe = await recipeIn({
            "a.ts": 'import type { Box } from "./box";\nexport interface Holder { box: Box<string> }\nexport function f(a: Holder) { return a; }',
            "box.d.ts": deeperBox,
        }, "a.ts");
        assert.ok(recipe.kind === "named");
        assert.ok(recipe.structural.kind === "object");
        const inner = recipe.structural.properties[0];
        assert.ok(inner !== undefined);
        assert.ok(inner.recipe.kind === "named");
        assert.equal(inner.recipe.structural.kind, "unknown");
    });

    test("a mapped library type such as Record is still read for what it holds", async () => {
        const recipe = await recipeOf("export function f(a: Record<string, number>) { return a; }");
        assert.ok(recipe.kind === "object");
        assert.deepEqual(recipe.index, {
            kind: "number",
        });
    });
});

describe("typeKeyOf", () => {
    test("a type from outside the project carries no key, so no value factory is looked for", async () => {
        assert.equal(await keyOfParameter("export function f(a: Date) { return a; }", projectRoot), undefined);
    });

    test("a type whose name was declared in no file carries no key", async () => {
        assert.equal(await keyOfParameter("export function f(a: typeof globalThis) { return a; }", projectRoot), undefined);
    });

    test("a type declared outside the root carries a key with its whole path", async () => {
        assert.equal(await keyOfParameter("export interface Thing { x: number }\nexport function f(a: Thing) { return a; }", "/elsewhere"), `${projectRoot}/a.ts#Thing`);
    });
});

describe("isLibraryType", () => {
    test("a class a declaration file declares is a library type", async () => {
        const read = await readParameterType({
            "a.ts": 'import type { Box } from "./box";\nexport function f(a: Box<number>) { return a; }',
            "box.d.ts": deeperBox,
        });
        assert.equal(isLibraryType(read.type), true);
    });

    test("a runtime type the run builds is not a library type", async () => {
        const read = await readParameterType({
            "a.ts": "export function f(a: Map<string, number>) { return a; }",
        });
        assert.equal(isLibraryType(read.type), false);
    });

    test("a type the project declares is not a library type", async () => {
        const read = await readParameterType({
            "a.ts": "export interface Thing { x: number }\nexport function f(a: Thing) { return a; }",
        });
        assert.equal(isLibraryType(read.type), false);
    });

    test("a type a library maps out with no name of its own is not a library type", async () => {
        const read = await readParameterType({
            "a.ts": "export function f(a: Record<string, number>) { return a; }",
        });
        assert.equal(isLibraryType(read.type), false);
    });

    test("a type that is not an object is not a library type", async () => {
        const read = await readParameterType({
            "a.ts": "export function f(a: string) { return a; }",
        });
        assert.equal(isLibraryType(read.type), false);
    });

    test("an object type with no symbol is not a library type", async () => {
        const read = await readParameterType({
            "a.ts": "export function f(a: [number, string]) { return a; }",
        });
        assert.equal(read.type.getSymbol(), undefined);
        assert.equal(isLibraryType(read.type), false);
    });
});

describe("leafKey", () => {
    test("each built-in value type has a key of its own kind", () => {
        assert.equal(leafKey({ kind: "string" }), "builtin#string");
        assert.equal(leafKey({ kind: "number" }), "builtin#number");
        assert.equal(leafKey({ kind: "bigint" }), "builtin#bigint");
        assert.equal(leafKey({ kind: "boolean" }), "builtin#boolean");
        assert.equal(leafKey({ kind: "date" }), "builtin#Date");
        assert.equal(leafKey({ kind: "regexp" }), "builtin#RegExp");
        assert.equal(leafKey({ kind: "url" }), "builtin#URL");
        assert.equal(leafKey({ kind: "bytes", name: "Uint8Array" }), "builtin#Uint8Array");
        assert.equal(leafKey({ kind: "error", name: "RangeError" }), "builtin#RangeError");
    });

    test("unknown and any are one kind", () => {
        assert.equal(leafKey({ kind: "any" }), "builtin#unknown");
    });

    test("object, which the run cannot build, has a key of its own, and no other type it cannot build has one", () => {
        assert.equal(leafKey({ kind: "unknown", text: "object" }), "builtin#object");
        assert.equal(leafKey({ kind: "unknown", text: "symbol" }), undefined);
    });

    test("a recipe of any other kind has none", () => {
        assert.equal(leafKey({ kind: "null" }), undefined);
        assert.equal(leafKey({ kind: "literal", value: "a" }), undefined);
        assert.equal(leafKey({ kind: "array", element: { kind: "string" } }), undefined);
    });
});

describe("writtenAliasKey", () => {
    //
    // The project's files: an alias of a generic library type, imported under the alias's own name
    // by the file whose function `f` takes it, and an interface.
    //
    const files: Record<string, string> = {
        "json.ts": "export type JsonObject = Readonly<Record<string, unknown>>;\nexport interface Shelf { size: number }\n",
        "a.ts": 'import type { JsonObject, Shelf } from "./json";\nexport function f(a: JsonObject, b: Shelf, c: string, d: Readonly<Shelf>) { return [a, b, c, d]; }\n',
    };

    test("a parameter written as an alias the project declares gives the alias's key and name", async () => {
        const made = await fixture(files);
        const parameter = parameterOfF(made.source("a.ts"));
        assert.deepEqual(writtenAliasKey(made.context, parameter.type), {
            key: "json.ts#JsonObject",
            name: "JsonObject",
        });
    });

    test("an interface, a type that is no reference, a library alias and no type at all give none", async () => {
        const made = await fixture(files);
        const declaration = made.source("a.ts").statements[1];
        assert.ok(declaration !== undefined);
        assert.ok(ts.isFunctionDeclaration(declaration));
        const types = declaration.parameters.map((parameter) => parameter.type);
        assert.equal(writtenAliasKey(made.context, types[1]), undefined);
        assert.equal(writtenAliasKey(made.context, types[2]), undefined);
        assert.equal(writtenAliasKey(made.context, types[3]), undefined);
        assert.equal(writtenAliasKey(made.context, undefined), undefined);
    });

    test("a name declared nowhere gives none, on its own or inside a namespace declared nowhere", async () => {
        const made = await fixture({
            "a.ts": "export function f(a: Missing, b: Nowhere.Missing) { return [a, b]; }\n",
        });
        const declaration = made.source("a.ts").statements[0];
        assert.ok(declaration !== undefined);
        assert.ok(ts.isFunctionDeclaration(declaration));
        for (const parameter of declaration.parameters) {
            assert.equal(writtenAliasKey(made.context, parameter.type), undefined);
        }
    });

    test("a parameter of a JsonObject is read under the alias, around what the type holds", async () => {
        const made = await fixture(files);
        const parameter = parameterOfF(made.source("a.ts"));
        const recipe = recipeUnderWrittenAlias(made.context, recipeFor(made.context, made.built.checker.getTypeAtLocation(parameter), parameter), parameter.type);
        assert.ok(recipe.kind === "named");
        assert.equal(recipe.key, "json.ts#JsonObject");
        assert.equal(recipe.structural.kind, "object");
    });

    test("an alias of a project interface is read under the alias, around the interface's own recipe", async () => {
        const made = await fixture({
            "a.ts": "export interface Shelf { size: number }\nexport type Storage = Shelf;\nexport function f(a: Storage) { return a; }\n",
        });
        const parameter = parameterOfF(made.source("a.ts"));
        const inner = recipeFor(made.context, made.built.checker.getTypeAtLocation(parameter), parameter);
        assert.ok(inner.kind === "named");
        assert.equal(inner.key, "a.ts#Shelf");
        assert.deepEqual(recipeUnderWrittenAlias(made.context, inner, parameter.type), {
            kind: "named",
            key: "a.ts#Storage",
            name: "Storage",
            structural: inner,
        });
    });

    test("a context Faultline hands a scenario is never put under an alias, whatever name it is written with", async () => {
        const made = await fixture({
            "a.ts": "export type Context = { expect(condition: boolean): void };\nexport function f(a: Context) { return a; }\n",
        });
        const parameter = parameterOfF(made.source("a.ts"));
        const effect: Recipe = {
            kind: "effect",
            effect: "scenario",
        };
        assert.equal(recipeUnderWrittenAlias(made.context, effect, parameter.type), effect);
    });

    test("a recipe that already carries the alias's key, or a type written with no alias, is left as it is", async () => {
        const made = await fixture({
            "a.ts": "export type Point = { x: number };\nexport function f(a: Point, b: number) { return [a, b]; }\n",
        });
        const declaration = made.source("a.ts").statements[1];
        assert.ok(declaration !== undefined);
        assert.ok(ts.isFunctionDeclaration(declaration));
        const [point, count] = declaration.parameters;
        assert.ok(point !== undefined);
        assert.ok(count !== undefined);
        const pointRecipe = recipeFor(made.context, made.built.checker.getTypeAtLocation(point), point);
        assert.equal(recipeUnderWrittenAlias(made.context, pointRecipe, point.type), pointRecipe);
        const countRecipe = recipeFor(made.context, made.built.checker.getTypeAtLocation(count), count);
        assert.equal(recipeUnderWrittenAlias(made.context, countRecipe, count.type), countRecipe);
    });
});

describe("libraryKey", () => {
    test("a library type's key names its declaration and not its type arguments", async () => {
        const read = await readParameterType({
            "a.ts": 'import type { Box } from "./box";\nexport function f(a: Box<Box<number>>) { return a; }',
            "box.d.ts": deeperBox,
        });
        assert.equal(libraryKey(read.context, read.type), "box.d.ts#Box");
        assert.equal(typeKeyOf(read.context, read.type), "box.d.ts#Box");
    });

    test("a runtime type the run builds has no library key", async () => {
        const read = await readParameterType({
            "a.ts": "export function f(a: Date) { return a; }",
        });
        assert.equal(libraryKey(read.context, read.type), undefined);
    });

    test("a project's own name for a library type keeps the project's key", async () => {
        const read = await readParameterType({
            "a.ts": 'import type { Box } from "./box";\nexport type Boxed = Box<number>;\nexport function f(a: Boxed) { return a; }',
            "box.d.ts": deeperBox,
        });
        assert.equal(typeKeyOf(read.context, read.type), "a.ts#Boxed");
    });
});
