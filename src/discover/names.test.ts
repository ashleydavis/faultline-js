// Tests which nodes count as functions, which of them a report gives a line of its own, the label
// each is given and whether a declaration is exported. Each test parses a small piece of text on
// its own, since none of this needs a type checker. It then checks what was read from every node.

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import { parse } from "./fixture.test.ts";
import { functionLabel, isExported, isFunctionNode, isReportedFunction } from "./names.ts";

// The most nodes a walk visits. Every piece of text these tests parse holds far fewer, so reaching
// it means the walk is not coming to an end.
export const nodesMost = 10000;

// Every node in `root`, `root` first, in the order they are written. A stack of nodes still to
// visit takes the place of a call per level, so a deep tree cannot overflow the call stack.
export function nodesIn(root: ts.Node): ts.Node[] {
    const visited: ts.Node[] = [];
    const pending: ts.Node[] = [root];
    for (let turn = 0; turn < nodesMost; turn += 1) {
        const node = pending.pop();
        if (node === undefined) {
            return visited;
        }
        visited.push(node);
        const children: ts.Node[] = [];
        ts.forEachChild(node, (child) => {
            children.push(child);
        });
        pending.push(...children.reverse());
    }
    assert.fail(`A walk visited ${nodesMost} nodes without coming to an end.`);
}

// The labels of every function a report would give a line of its own, in the order they are
// written.
export function reported(text: string): string[] {
    return nodesIn(parse(text)).filter(isReportedFunction).map((node) => functionLabel(node));
}

describe("nodesIn", () => {
    test("every node is visited once, the root first and the rest in the order they are written", () => {
        const source = parse("const first = 1;\nconst second = 2;");
        const nodes = nodesIn(source);
        assert.equal(nodes[0], source);
        assert.deepEqual(nodes.filter(ts.isIdentifier).map((node) => node.text), ["first", "second"]);
        assert.equal(new Set(nodes).size, nodes.length);
    });

    test("a tree with more nodes than the walk visits is a programmer error", () => {
        const statements = Array.from({
            length: nodesMost,
        }, (_unused, index) => `const held${index} = ${index};`).join("\n");
        assert.throws(() => nodesIn(parse(statements)), /without coming to an end/);
    });
});

describe("reported", () => {
    test("the labels come in the order the functions are written", () => {
        assert.deepEqual(reported("function first() {}\nfunction second() {}"), ["first", "second"]);
    });
});

describe("isFunctionNode", () => {
    test("everything that carries a body is a function node", () => {
        assert.deepEqual(nodesIn(parse("function a() {}\nconst b = () => 1;\nconst c = function () {};\nclass D { m() {} constructor() {} get g() { return 1; } set s(v: number) {} }")).filter(isFunctionNode).map((node) => ts.SyntaxKind[node.kind]), [
            "FunctionDeclaration",
            "ArrowFunction",
            "FunctionExpression",
            "MethodDeclaration",
            "Constructor",
            "GetAccessor",
            "SetAccessor",
        ]);
    });

    test("a node that carries no body is no function node", () => {
        const nodes = nodesIn(parse("const held = 1;"));
        assert.ok(nodes.length > 0);
        assert.deepEqual(nodes.filter(isFunctionNode), []);
    });
});

describe("isReportedFunction", () => {
    test("a declared function gets a line of its own", () => {
        assert.deepEqual(reported("export function greet() {}"), ["greet"]);
    });

    test("a function with no body is not reported, because it holds no code to run", () => {
        assert.deepEqual(reported("declare function greet(): void;"), []);
    });

    test("an arrow given a name by what it is assigned to is reported under that name", () => {
        assert.deepEqual(reported("const greet = () => 1;"), ["greet"]);
    });

    test("a callback belongs to its caller and gets no line of its own", () => {
        assert.deepEqual(reported("function f(items: number[]) { return items.map((x) => x + 1); }"), ["f"]);
    });
});

describe("functionLabel", () => {
    test("a method carries the name of the class it is on", () => {
        assert.deepEqual(reported("class Store { read() {} }"), ["Store.read"]);
    });

    test("a constructor is named after the class it builds", () => {
        assert.deepEqual(reported("class Store { constructor() {} }"), ["Store.constructor"]);
    });

    test("a getter and a setter each get a line", () => {
        assert.deepEqual(reported("class Store { get size() { return 1; } set size(v: number) {} }"), ["Store.size", "Store.size"]);
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

    test("a class with no name still reads", () => {
        assert.deepEqual(reported("const C = class { m() {} };"), ["(anonymous class).m"]);
    });

    test("a method on an object passed straight to a call is named on its own, because no name holds the object", () => {
        assert.deepEqual(reported("use({ run() {} });"), ["run"]);
    });

    test("a function passed straight to a call is labelled anonymous, because no name is given to it", () => {
        assert.deepEqual(nodesIn(parse("use(function () {});")).filter(isFunctionNode).map((node) => functionLabel(node)), ["(anonymous)"]);
    });

    test("a method whose name is worked out while the code runs is named as it is written", () => {
        assert.deepEqual(reported("const key = \"read\";\nclass Store { [key]() {} }"), ["Store.[key]"]);
    });

    test("a function declared with no name is called anonymous", () => {
        assert.deepEqual(reported("export default function () {\n    return 1;\n}"), ["(anonymous)"]);
    });

    test("a method of a class declared with no name carries the anonymous class's name", () => {
        assert.deepEqual(reported("export default class {\n    read() {\n        return 1;\n    }\n}"), ["(anonymous class).read"]);
    });
});

describe("isExported", () => {
    test("an exported declaration is told from one that is not", () => {
        assert.deepEqual(nodesIn(parse("export function a() {}\nfunction b() {}\nexport const c = 1;\nconst d = 2;")).filter((node) => ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)).map((node) => isExported(node)), [true, false, true, false]);
    });

    test("a whole file is not exported, because no file outside it holds it", () => {
        assert.equal(isExported(parse("export const a = 1;")), false);
    });
});
