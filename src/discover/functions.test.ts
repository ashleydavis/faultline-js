// Tests the reading of the functions in one file: every kind of function, how Faultline reaches
// each one, the type of each parameter and what stops Faultline calling the ones it cannot. Each
// test writes a small file into a project in memory, reads it through a real type checker and
// checks what came back.

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import { fixture, parse } from "./fixture.test.ts";
import { fileLabel, memberName, readFile, returnKeyOf, topLevelLabel } from "./functions.ts";
import type { FileFacts, FunctionInfo } from "./functions.ts";

// Reads one file written on the spot.
export async function read(text: string): Promise<FileFacts> {
    const made = await fixture({
        "a.ts": text,
    });
    return readFile(made.context, made.source("a.ts"), "a.ts");
}

// The functions a file declares, leaving out the top-level code that every file has first.
export async function declared(text: string): Promise<FunctionInfo[]> {
    const functions = (await read(text)).functions;
    assert.equal(functions[0]?.label, topLevelLabel);
    return functions.slice(1);
}

// The one function with this label.
export async function named(text: string, label: string): Promise<FunctionInfo> {
    const found = (await read(text)).functions.find((info) => info.label === label);
    assert.ok(found !== undefined, `No function is labelled ${label}.`);
    return found;
}

describe("read", () => {
    test("a file is read with its top-level code first and every function after it", async () => {
        const facts = await read("export function greet() {}");
        assert.deepEqual(facts.functions.map((info) => info.label), [topLevelLabel, "greet"]);
        assert.deepEqual(facts.uncallable, []);
    });
});

describe("declared", () => {
    test("the top-level code is left out", async () => {
        assert.deepEqual((await declared("export function greet() {}")).map((info) => info.label), ["greet"]);
    });
});

describe("named", () => {
    test("the function with the label is found", async () => {
        assert.equal((await named("export function greet() {}\nexport function wave() {}", "wave")).label, "wave");
    });

    test("a label no function has is a programmer error", async () => {
        await assert.rejects(named("export function greet() {}", "wave"), /No function is labelled wave/);
    });
});

describe("readFile", () => {
    test("every function is read, with the line it starts on", async () => {
        const functions = await declared("export function greet(name: string) {\n    return name;\n}");
        assert.equal(functions.length, 1);
        assert.equal(functions[0]?.label, "greet");
        assert.equal(functions[0]?.line, 1);
    });

    test("an exported function is reached by the name it is exported under", async () => {
        assert.deepEqual((await declared("export function greet() {}"))[0]?.reach, {
            how: "export",
            name: "greet",
        });
    });

    test("a function exported by a list is reached by the name the list gives it", async () => {
        assert.deepEqual((await declared("function greet() {}\nexport { greet as hello };"))[0]?.reach, {
            how: "export",
            name: "hello",
        });
    });

    test("a function the file does not export is reached by its own name and says the file keeps it", async () => {
        assert.deepEqual((await declared("function hidden() {}\nexport function shown() { hidden(); }"))[0]?.reach, {
            how: "private",
            name: "hidden",
        });
    });

    test("an arrow function the file does not export is reached by the name of its constant", async () => {
        assert.deepEqual((await declared("const hidden = () => 1;\nexport function shown() { return hidden(); }"))[0]?.reach, {
            how: "private",
            name: "hidden",
        });
    });

    test("a function written inside another function says why no call reaches it", async () => {
        assert.equal((await named("export function outer() { function inner() {} return inner; }", "inner")).reach.how, "inside");
    });

    test("a class the file does not export is reached by its own name", async () => {
        assert.deepEqual((await named("class Store { read() {} }\nexport function use() { return new Store(); }", "Store.read")).reach, {
            how: "method",
            className: "Store",
            classExport: "Store",
            name: "read",
            onClass: false,
            accessor: "none",
        });
    });

    test("a method says which class it is on and what that class is exported as", async () => {
        assert.deepEqual((await named("export class Store { read() {} }", "Store.read")).reach, {
            how: "method",
            className: "Store",
            classExport: "Store",
            name: "read",
            onClass: false,
            accessor: "none",
        });
    });

    test("a method on the class rather than on an instance says so", async () => {
        const reach = (await named("export class Store { static make() {} }", "Store.make")).reach;
        assert.equal(reach.how === "method" ? reach.onClass : false, true);
    });

    test("a getter and a setter each say which they are", async () => {
        assert.deepEqual((await declared("export class Store { get size() { return 1; } set size(v: number) {} }")).map((info) => (info.reach.how === "method" ? info.reach.accessor : "none")), ["get", "set"]);
    });

    test("a parameter is read with its name and whether it may be left out", async () => {
        const parameters = (await declared("export function f(a: string, b?: number, ...rest: string[]) {}"))[0]?.parameters;
        assert.ok(parameters !== undefined);
        assert.deepEqual(parameters.map((parameter) => parameter.name), ["a", "b", "rest"]);
        assert.deepEqual(parameters.map((parameter) => parameter.optional), [false, true, false]);
        assert.deepEqual(parameters.map((parameter) => parameter.rest), [false, false, true]);
    });

    test("a parameter with a default may be left out", async () => {
        assert.equal((await declared("export function f(a = 1) {}"))[0]?.parameters[0]?.optional, true);
    });

    test("a function that hands back a promise says so", async () => {
        assert.equal((await declared("export async function f() {}"))[0]?.async, true);
        assert.equal((await declared("export function f(): Promise<number> { return Promise.resolve(1); }"))[0]?.async, true);
        assert.equal((await declared("export function f() { return 1; }"))[0]?.async, false);
    });

    test("a class is read with its constructor's parameters", async () => {
        const facts = await read("export class Store { constructor(readonly name: string, count: number) {} }");
        assert.equal(facts.classes.length, 1);
        assert.deepEqual(facts.classes[0]?.parameters.map((parameter) => parameter.name), ["name", "count"]);
        assert.equal(facts.classes[0]?.exportName, "Store");
    });

    test("a class the file does not export says it is exported under no name", async () => {
        assert.equal((await read("class Store {}\nexport const a = 1;")).classes[0]?.exportName, "");
    });

    test("a file with no function in it reads as having only its top-level code", async () => {
        const facts = await read("export const a = 1;\nexport interface B { x: number }");
        assert.deepEqual(facts.functions, [
            {
                label: topLevelLabel,
                file: "a.ts",
                line: 1,
                reach: {
                    how: "module",
                },
                parameters: [],
                async: true,
            },
        ]);
        assert.deepEqual(facts.uncallable, []);
    });

    test("a function written inside another says which one it is inside", async () => {
        assert.equal((await named("export function outer() { function inner() {} return inner; }", "inner")).within, "outer");
    });

    test("a function at the top of a file is inside no other", async () => {
        assert.equal((await declared("export function alone() {}"))[0]?.within, undefined);
    });

    test("a function two deep names the one directly around it", async () => {
        assert.equal((await named("export function outer() { function middle() { function inner() {} return inner; } return middle; }", "inner")).within, "middle");
    });

    test("an arrow function exported as a constant is reached by the name of the constant", async () => {
        assert.deepEqual((await declared("export const greet = () => 1;"))[0]?.reach, {
            how: "export",
            name: "greet",
        });
    });

    test("a method on a class written inside a function cannot be called and says why", async () => {
        const facts = await read("export function make() { class Inner { run() {} } return new Inner(); }");
        assert.deepEqual(facts.functions.find((info) => info.label === "Inner.run")?.reach, {
            how: "inside",
            because: "its class is written inside a function, so only that function reaches it",
        });
        assert.deepEqual(facts.uncallable, [
            {
                label: "Inner.run",
                line: 1,
                because: "its class is written inside a function, so only that function reaches it",
            },
        ]);
    });

    test("a script with no import or export exports no name, so its functions are reached by their own names", async () => {
        assert.deepEqual((await declared("function hidden() {}"))[0]?.reach, {
            how: "private",
            name: "hidden",
        });
    });

    test("a method on a class with no name says so and is reached through the constant holding the class", async () => {
        assert.deepEqual((await named("export const Store = class { read() {} };", "(anonymous class).read")).reach, {
            how: "method",
            className: "(anonymous class)",
            classExport: "Store",
            name: "read",
            onClass: false,
            accessor: "none",
        });
        const kept = (await named("const Store = class { read() {} };\nexport const a = 1;", "(anonymous class).read")).reach;
        assert.equal(kept.how === "method" ? kept.classExport : "not a method", "Store");
    });

    test("an export that stands for something declared in no file names no function", async () => {
        assert.deepEqual((await declared('export { missing } from "./nowhere.ts";\nexport function shown() {}')).map((info) => info.reach), [
            {
                how: "export",
                name: "shown",
            },
        ]);
    });

    test("the top-level code of a file comes first, reached by importing the file", async () => {
        const facts = await read("export function f() {}");
        assert.equal(facts.functions[0]?.label, topLevelLabel);
        assert.deepEqual(facts.functions[0]?.reach, {
            how: "module",
        });
        assert.equal(facts.functions[0]?.async, true);
    });

    test("a constructor is reached by building an instance of its class", async () => {
        assert.deepEqual((await named("export class Store { constructor(name: string) {} }", "Store.constructor")).reach, {
            how: "construct",
            className: "Store",
            classExport: "Store",
        });
        assert.deepEqual((await named("class Kept { constructor() {} }\nexport const a = 1;", "Kept.constructor")).reach, {
            how: "construct",
            className: "Kept",
            classExport: "Kept",
        });
    });

    test("a constructor and an instance method of an abstract class cannot be called but a static method can", async () => {
        const text = "export abstract class Vehicle { constructor() {} wheels() { return 1; } static unit() { return 1; } }";
        const facts = await read(text);
        assert.deepEqual(facts.uncallable.map((uncallable) => uncallable.label), ["Vehicle.constructor", "Vehicle.wheels"]);
        assert.ok(facts.uncallable.every((uncallable) => uncallable.because === "its class is abstract, so no instance of it can be built"));
        assert.equal((await named(text, "Vehicle.unit")).reach.how, "method");
    });

    test("a private method of a class cannot be called and says why", async () => {
        assert.deepEqual((await read("export class Store { #tidy() {} run() { this.#tidy(); } }")).uncallable, [
            {
                label: "Store.#tidy",
                line: 1,
                because: "it is the private method #tidy of its class, so only code inside the class reaches it",
            },
        ]);
    });

    test("a method whose name is worked out while the code runs cannot be called and says why", async () => {
        const facts = await read("export class Store { [Symbol.iterator]() { return [][Symbol.iterator](); } }");
        assert.equal(facts.uncallable.length, 1);
        assert.equal(facts.uncallable[0]?.because, "its name is worked out while the code runs, so there is no name to call it by");
    });

    test("a method named by text is reached under that text", async () => {
        assert.deepEqual((await named('export class Store { "read-all"() {} }', "Store.read-all")).reach, {
            how: "method",
            className: "Store",
            classExport: "Store",
            name: "read-all",
            onClass: false,
            accessor: "none",
        });
    });

    test("a method, getter and setter of an object held by a constant at the top of the file are reached through the constant", async () => {
        assert.deepEqual((await declared("export const store = { read() { return 1; }, get size() { return 1; }, set size(value: number) {} };")).map((info) => info.reach), [
            {
                how: "property",
                holder: "store",
                name: "read",
                accessor: "none",
            },
            {
                how: "property",
                holder: "store",
                name: "size",
                accessor: "get",
            },
            {
                how: "property",
                holder: "store",
                name: "size",
                accessor: "set",
            },
        ]);
        assert.deepEqual((await declared("const tools = { run() {} };\nexport { tools as shared };"))[0]?.reach, {
            how: "property",
            holder: "shared",
            name: "run",
            accessor: "none",
        });
        assert.deepEqual((await declared("const tools = { run() {} };\nexport const a = 1;"))[0]?.reach, {
            how: "property",
            holder: "tools",
            name: "run",
            accessor: "none",
        });
    });

    test("a method of an object no constant at the top of the file holds cannot be called and says why", async () => {
        const facts = await read("export function make() { return { run() {} }; }");
        assert.deepEqual(facts.uncallable.map((uncallable) => uncallable.label), ["run"]);
        assert.ok(facts.uncallable[0]?.because.includes("no constant at the top of the file holds"));
        assert.equal((await read("export const outer = { inner: { run() {} } };")).uncallable.length, 1);
    });

    test("a method of an object whose name is worked out while the code runs cannot be called", async () => {
        assert.equal((await read("const key = 'x';\nexport const store = { [key]() {} };")).uncallable[0]?.because, "its name is worked out while the code runs, so there is no name to call it by");
    });

    test("a function written inside another is listed as one Faultline cannot call, with what stops it", async () => {
        assert.deepEqual((await read("export function outer() {\n    function inner() {}\n    return inner;\n}")).uncallable, [
            {
                label: "inner",
                line: 2,
                because: "it is written inside another function, so only that function reaches it",
            },
        ]);
    });

    test("a function the checker gives no signature for hands back no promise and no type", async () => {
        // The checker gives no signature only for a node it did not parse, which a file read from
        // the project never holds, so the checker here is told to give none.
        const made = await fixture({
            "a.ts": "export interface Thing { x: number }\nexport function aThing(): Promise<Thing> { return Promise.resolve({ x: 1 }); }",
        });
        made.context.checker = {
            ...made.context.checker,
            getSignatureFromDeclaration: () => undefined,
        };
        const found = readFile(made.context, made.source("a.ts"), "a.ts").functions.find((info) => info.label === "aThing");
        assert.ok(found !== undefined);
        assert.equal(found.async, false);
        assert.equal(found.returnKey, undefined);
    });

    test("every parameter carries its type as the checker writes it", async () => {
        const parameters = (await declared("export interface Thing { x: number }\nexport function f(a: string, b: Thing, c: number[] | 'all') {}"))[0]?.parameters;
        assert.ok(parameters !== undefined);
        assert.deepEqual(parameters.map((parameter) => parameter.typeName), ["string", "Thing", "number[] | \"all\""]);
    });
});

describe("returnKeyOf", () => {
    test("a function returning a type of the project's own gives the key and name of that type", async () => {
        const made = await fixture({
            "a.ts": "export interface Thing { x: number }\nexport function aThing(): Thing { return { x: 1 }; }",
        });
        const declaration = made.source("a.ts").statements[1];
        assert.ok(declaration !== undefined);
        assert.ok(ts.isFunctionDeclaration(declaration));
        assert.deepEqual(returnKeyOf(made.context, declaration), {
            key: "a.ts#Thing",
            name: "Thing",
        });
    });

    test("a function returning a built-in value type gives the key of that kind of value", async () => {
        const made = await fixture({
            "a.ts": [
                "export function aDate(): Date { return new Date(); }",
                "export function aName(): string { return \"a\"; }",
                "export function aCount(): number { return 1; }",
                "export function aFlag(): boolean { return true; }",
                "export function aFault(): TypeError { return new TypeError(\"a\"); }",
            ].join("\n"),
        });
        const keys = made.source("a.ts").statements.map((declaration) => {
            assert.ok(ts.isFunctionDeclaration(declaration));
            return returnKeyOf(made.context, declaration);
        });
        assert.deepEqual(keys, [
            {
                key: "builtin#Date",
                name: "Date",
            },
            {
                key: "builtin#string",
                name: "string",
            },
            {
                key: "builtin#number",
                name: "number",
            },
            {
                key: "builtin#boolean",
                name: "boolean",
            },
            {
                key: "builtin#TypeError",
                name: "TypeError",
            },
        ]);
    });

    test("a function returning an alias the project declares, unknown or object gives the key a parameter of it is looked up by", async () => {
        const made = await fixture({
            "a.ts": [
                "export type JsonObject = Readonly<Record<string, unknown>>;",
                "export function aRecord(): JsonObject { return {}; }",
                "export function aValue(): unknown { return 1; }",
                "export function anObject(): object { return {}; }",
            ].join("\n"),
        });
        const keys = made.source("a.ts").statements.slice(1).map((declaration) => {
            assert.ok(ts.isFunctionDeclaration(declaration));
            return returnKeyOf(made.context, declaration);
        });
        assert.deepEqual(keys, [
            {
                key: "a.ts#JsonObject",
                name: "JsonObject",
            },
            {
                key: "builtin#unknown",
                name: "unknown",
            },
            {
                key: "builtin#object",
                name: "object",
            },
        ]);
    });

    test("a function returning a literal, a union, a type written out or a container gives no key", async () => {
        const made = await fixture({
            "a.ts": [
                "export function aWord(): \"a\" { return \"a\"; }",
                "export function aMaybe(): string | number { return 1; }",
                "export function aNames(): string[] { return []; }",
                "export function aPoint(): { x: number } { return { x: 1 }; }",
                "export function aList(): Map<string, number> { return new Map(); }",
            ].join("\n"),
        });
        for (const declaration of made.source("a.ts").statements) {
            assert.ok(ts.isFunctionDeclaration(declaration));
            assert.equal(returnKeyOf(made.context, declaration), undefined);
        }
    });
});

describe("fileLabel", () => {
    test("a file under the root is labelled by its path from the root", () => {
        assert.equal(fileLabel("/project", "/project/src/a.ts"), "src/a.ts");
    });

    test("a file outside the root is labelled by its whole path", () => {
        assert.equal(fileLabel("/project", "/elsewhere/a.ts"), "/elsewhere/a.ts");
    });
});

describe("memberName", () => {
    test("a member's name is read from an identifier, text, a number or a bracketed literal", () => {
        const owner = parse("class A { plain() {} 'text'() {} 3() {} ['bracketed']() {} [Symbol.iterator]() {} [`x`]() {} }").statements[0];
        assert.ok(owner !== undefined);
        assert.ok(ts.isClassDeclaration(owner));
        const names = owner.members.map((member) => member.name);
        assert.ok(names.every((name) => name !== undefined));
        assert.deepEqual(names.map((name) => (name === undefined ? "no name" : memberName(name))), ["plain", "text", "3", "bracketed", undefined, undefined]);
    });
});
