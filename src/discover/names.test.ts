import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { parse } from "../testing.ts";
import { functionLabel, isExported, isFunctionNode, isReportedFunction } from "./names.ts";

// The names of every function a report would give a line of its own, in the order they are written.
function reported(text: string): string[] {
    const out: string[] = [];
    const walk = (node: ts.Node): void => {
        if (isReportedFunction(node)) {
            out.push(functionLabel(node));
        }
        ts.forEachChild(node, walk);
    };
    walk(parse(text));
    return out;
}

test("everything that carries a body is a function node", () => {
    const kinds: ts.Node[] = [];
    const walk = (node: ts.Node): void => {
        if (isFunctionNode(node)) {
            kinds.push(node);
        }
        ts.forEachChild(node, walk);
    };
    walk(parse("function a() {}\nconst b = () => 1;\nconst c = function () {};\nclass D { m() {} constructor() {} get g() { return 1; } set s(v: number) {} }"));
    assert.equal(kinds.length, 7);
});

test("a declared function gets a line of its own", () => {
    assert.deepEqual(reported("export function greet() {}"), ["greet"]);
});

test("a function with no body is not reported, because there is nothing in it to run", () => {
    assert.deepEqual(reported("declare function greet(): void;"), []);
});

test("an arrow given a name by what it is assigned to is reported under that name", () => {
    assert.deepEqual(reported("const greet = () => 1;"), ["greet"]);
});

test("a callback belongs to its caller and gets no line of its own", () => {
    assert.deepEqual(reported("function f(items: number[]) { return items.map((x) => x + 1); }"), ["f"]);
});

test("a method carries the name of the class it is on", () => {
    assert.deepEqual(reported("class Store { read() {} }"), ["Store.read"]);
});

test("a constructor is named after the class it builds", () => {
    assert.deepEqual(reported("class Store { constructor() {} }"), ["Store.constructor"]);
});

test("a getter and a setter each get a line", () => {
    assert.deepEqual(reported("class Store { get size() { return 1; } set size(v: number) {} }"), [
        "Store.size",
        "Store.size",
    ]);
});

test("a method on an object is named after what the object was assigned to", () => {
    assert.deepEqual(reported("const tools = { run() {} };"), ["tools.run"]);
});

test("a method written with a name that is not an identifier still reads", () => {
    assert.deepEqual(reported('class Store { "read it"() {} }'), ["Store.read it"]);
});

test("a private name keeps the hash it was written with", () => {
    assert.deepEqual(reported("class Store { #hidden() {} }"), ["Store.#hidden"]);
});

test("an exported declaration is told from one that is not", () => {
    const source = parse("export function a() {}\nfunction b() {}\nexport const c = 1;\nconst d = 2;");
    const answers: boolean[] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) {
            answers.push(isExported(node));
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    assert.deepEqual(answers, [true, false, true, false]);
});

test("a class with no name still reads", () => {
    assert.deepEqual(reported("const C = class { m() {} };"), ["(anonymous class).m"]);
});
