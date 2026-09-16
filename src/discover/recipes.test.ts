import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { fixture } from "../testing.ts";
import { recipeFor, typeKeyOf, type Recipe } from "./recipes.ts";

// Reads the recipe for the one parameter of a function called `f`.
function recipeOf(text: string, extra: Record<string, string> = {}): Recipe {
    const made = fixture({ "a.ts": text, ...extra });
    const source = made.source("a.ts");
    let found: Recipe | undefined;
    const walk = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.name?.text === "f" && node.parameters[0] !== undefined) {
            found = recipeFor(made.context, made.built.checker.getTypeAtLocation(node.parameters[0]), node.parameters[0]);
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    made.remove();
    if (found === undefined) {
        throw new Error("The fixture declares no function called f with a parameter.");
    }
    return found;
}

test("each primitive is read as itself", () => {
    assert.equal(recipeOf("export function f(a: string) { return a; }").kind, "string");
    assert.equal(recipeOf("export function f(a: number) { return a; }").kind, "number");
    assert.equal(recipeOf("export function f(a: boolean) { return a; }").kind, "boolean");
    assert.equal(recipeOf("export function f(a: bigint) { return a; }").kind, "bigint");
    assert.equal(recipeOf("export function f(a: null) { return a; }").kind, "null");
    assert.equal(recipeOf("export function f(a: undefined) { return a; }").kind, "undefined");
    assert.equal(recipeOf("export function f(a: any) { return a; }").kind, "any");
    assert.equal(recipeOf("export function f(a: unknown) { return a; }").kind, "any");
});

test("a literal is read as the one value it is", () => {
    assert.deepEqual(recipeOf('export function f(a: "x") { return a; }'), { kind: "literal", value: "x" });
    assert.deepEqual(recipeOf("export function f(a: 7) { return a; }"), { kind: "literal", value: 7 });
    assert.deepEqual(recipeOf("export function f(a: true) { return a; }"), { kind: "literal", value: true });
});

test("a union is read as every side of it", () => {
    const recipe = recipeOf('export function f(a: "x" | "y") { return a; }');
    assert.equal(recipe.kind, "union");
    assert.equal(recipe.kind === "union" ? recipe.options.length : 0, 2);
});

test("an optional parameter reads as the type it names, and is left out by the caller instead", () => {
    assert.equal(recipeOf("export function f(a?: string) { return a; }").kind, "string");
});

test("a type written out where it is used carries no key, so no factory is asked for", () => {
    const recipe = recipeOf("export function f(a: { x: number }) { return a; }");
    assert.equal(recipe.kind, "object");
});

test("an array is read as a list of its element", () => {
    const recipe = recipeOf("export function f(a: number[]) { return a; }");
    assert.equal(recipe.kind, "array");
    assert.equal(recipe.kind === "array" ? recipe.element.kind : "", "number");
});

test("a tuple is read element by element", () => {
    const recipe = recipeOf("export function f(a: [string, number]) { return a; }");
    assert.equal(recipe.kind, "tuple");
    assert.deepEqual(recipe.kind === "tuple" ? recipe.elements.map((one) => one.kind) : [], ["string", "number"]);
});

test("a map and a set are read with what they hold", () => {
    const asMap = recipeOf("export function f(a: Map<string, number>) { return a; }");
    assert.equal(asMap.kind, "map");
    const asSet = recipeOf("export function f(a: Set<string>) { return a; }");
    assert.equal(asSet.kind, "set");
});

test("the types every runtime already has are each read as themselves", () => {
    assert.equal(recipeOf("export function f(a: Date) { return a; }").kind, "date");
    assert.equal(recipeOf("export function f(a: RegExp) { return a; }").kind, "regexp");
    assert.equal(recipeOf("export function f(a: URL) { return a; }").kind, "url");
    assert.equal(recipeOf("export function f(a: Uint8Array) { return a; }").kind, "bytes");
    assert.equal(recipeOf("export function f(a: Error) { return a; }").kind, "error");
});

test("a promise is read with what it resolves to", () => {
    const recipe = recipeOf("export function f(a: Promise<string>) { return a; }");
    assert.equal(recipe.kind, "promise");
    assert.equal(recipe.kind === "promise" ? recipe.value.kind : "", "string");
});

test("a function type is read with what it returns", () => {
    const recipe = recipeOf("export function f(a: () => number) { return a; }");
    assert.equal(recipe.kind, "function");
    assert.equal(recipe.kind === "function" ? recipe.returns.kind : "", "number");
});

test("an object type is read property by property", () => {
    const recipe = recipeOf("export function f(a: { x: number; y?: string }) { return a; }");
    assert.equal(recipe.kind, "object");
    if (recipe.kind !== "object") {
        return;
    }
    assert.deepEqual(recipe.properties.map((one) => one.name), ["x", "y"]);
    assert.equal(recipe.properties[1]?.optional, true);
});

test("a type declared in the project carries the key a factory is found by", () => {
    const recipe = recipeOf("export interface Thing { x: number }\nexport function f(a: Thing) { return a; }");
    assert.equal(recipe.kind, "named");
    assert.equal(recipe.kind === "named" ? recipe.key : "", "a.ts#Thing");
    assert.equal(recipe.kind === "named" ? recipe.name : "", "Thing");
});

test("a named type still carries the properties it has, so a value is built without a factory", () => {
    const recipe = recipeOf("export interface Thing { x: number }\nexport function f(a: Thing) { return a; }");
    assert.equal(recipe.kind === "named" ? recipe.structural.kind : "", "object");
});

test("an index signature is read as well as the properties beside it", () => {
    const recipe = recipeOf("export function f(a: Record<string, number>) { return a; }");
    assert.equal(recipe.kind, "object");
    assert.equal(recipe.kind === "object" ? recipe.index?.kind : "", "number");
});

test("a type parameter with no constraint stands for anything", () => {
    assert.equal(recipeOf("export function f<T>(a: T) { return a; }").kind, "any");
});

test("a type parameter with a constraint is read as the constraint", () => {
    assert.equal(recipeOf("export function f<T extends string>(a: T) { return a; }").kind, "string");
});

test("a type that refers to itself stops rather than going on for ever", () => {
    const recipe = recipeOf("export interface Node { next: Node; value: number }\nexport function f(a: Node) { return a; }");
    assert.equal(recipe.kind, "named");
});

test("a symbol is read as something no value can be built for", () => {
    assert.equal(recipeOf("export function f(a: symbol) { return a; }").kind, "unknown");
});

test("a type from outside the project carries no key, so no factory is looked for", () => {
    const made = fixture({ "a.ts": "export function f(a: Date) { return a; }" });
    const source = made.source("a.ts");
    let key: string | undefined = "not read";
    const walk = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) && node.parameters[0] !== undefined) {
            key = typeKeyOf(made.context, made.built.checker.getTypeAtLocation(node.parameters[0]));
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    made.remove();
    assert.equal(key, undefined);
});
