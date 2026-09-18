import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "../testing.ts";
import { readFile, type FileFacts } from "./functions.ts";

// Reads one file written on the spot.
function read(text: string, extra: Record<string, string> = {}): FileFacts {
    const made = fixture({ "a.ts": text, ...extra });
    const facts = readFile(made.context, made.source("a.ts"), "a.ts");
    made.remove();
    return facts;
}

test("every function is read, with the line it starts on", () => {
    const facts = read("export function greet(name: string) {\n    return name;\n}");
    assert.equal(facts.functions.length, 1);
    assert.equal(facts.functions[0]?.label, "greet");
    assert.equal(facts.functions[0]?.line, 1);
});

test("an exported function is reached by the name it is exported under", () => {
    assert.deepEqual(read("export function greet() {}").functions[0]?.reach, { how: "export", name: "greet" });
});

test("a function exported by a list is reached by the name the list gives it", () => {
    const facts = read("function greet() {}\nexport { greet as hello };");
    assert.deepEqual(facts.functions[0]?.reach, { how: "export", name: "hello" });
});

test("a function the file does not export is reached off the copy's own holder", () => {
    const reach = read("function hidden() {}\nexport function shown() { hidden(); }").functions[0]?.reach;
    assert.deepEqual(reach, { how: "export", name: "__flt.hidden" });
});

test("a function written inside another function says why no call reaches it", () => {
    const reach = read("export function outer() { function inner() {} return inner; }").functions
        .find((one) => one.label === "inner")?.reach;
    assert.equal(reach?.how, "inside");
});

test("a class the file does not export is reached off the copy's own holder", () => {
    const reach = read("class Store { read() {} }\nexport function use() { return new Store(); }").functions
        .find((one) => one.label === "Store.read")?.reach;
    assert.deepEqual(reach, { how: "method", className: "Store", classExport: "__flt.Store", name: "read", onClass: false, accessor: "none" });
});

test("a method says which class it is on and what that class is exported as", () => {
    const facts = read("export class Store { read() {} }");
    const reach = facts.functions.find((one) => one.label === "Store.read")?.reach;
    assert.deepEqual(reach, {
        how: "method",
        className: "Store",
        classExport: "Store",
        name: "read",
        onClass: false,
        accessor: "none",
    });
});

test("a method on the class rather than on an instance says so", () => {
    const facts = read("export class Store { static make() {} }");
    const reach = facts.functions.find((one) => one.label === "Store.make")?.reach;
    assert.equal(reach?.how === "method" ? reach.onClass : false, true);
});

test("a getter and a setter each say which they are", () => {
    const facts = read("export class Store { get size() { return 1; } set size(v: number) {} }");
    const kinds = facts.functions.map((one) => (one.reach.how === "method" ? one.reach.accessor : "none"));
    assert.deepEqual(kinds, ["get", "set"]);
});

test("a parameter is read with its name and whether it may be left out", () => {
    const facts = read("export function f(a: string, b?: number, ...rest: string[]) {}");
    const parameters = facts.functions[0]!.parameters;
    assert.deepEqual(parameters.map((one) => one.name), ["a", "b", "rest"]);
    assert.deepEqual(parameters.map((one) => one.optional), [false, true, false]);
    assert.deepEqual(parameters.map((one) => one.rest), [false, false, true]);
});

test("a parameter with a default may be left out", () => {
    assert.equal(read("export function f(a = 1) {}").functions[0]?.parameters[0]?.optional, true);
});

test("a function that hands back a promise says so", () => {
    assert.equal(read("export async function f() {}").functions[0]?.async, true);
    assert.equal(read("export function f(): Promise<number> { return Promise.resolve(1); }").functions[0]?.async, true);
    assert.equal(read("export function f() { return 1; }").functions[0]?.async, false);
});

test("a class is read with its constructor's parameters", () => {
    const facts = read("export class Store { constructor(readonly name: string, count: number) {} }");
    assert.equal(facts.classes.length, 1);
    assert.deepEqual(facts.classes[0]?.parameters.map((one) => one.name), ["name", "count"]);
    assert.equal(facts.classes[0]?.exportName, "Store");
});

test("a class the file does not export says it is exported under no name", () => {
    assert.equal(read("class Store {}\nexport const a = 1;").classes[0]?.exportName, "");
});

test("a function in a sim file returning a type of the project's own is a test input factory", () => {
    const made = fixture({
        "a.ts": "export interface Thing { x: number }",
        "a.sim.ts": 'import type { Thing } from "./a.ts";\nexport function aThing(): Thing { return { x: 1 }; }',
    });
    const facts = readFile(made.context, made.source("a.sim.ts"), "a.sim.ts");
    made.remove();
    assert.equal(facts.factories.length, 1);
    assert.equal(facts.factories[0]?.key, "a.ts#Thing");
    assert.equal(facts.factories[0]?.exportName, "aThing");
    assert.equal(facts.factories[0]?.typeName, "Thing");
});

test("a method on an exported class returning that type is a test input factory too", () => {
    const made = fixture({
        "a.ts": "export interface Thing { x: number }",
        "a.sim.ts":
            'import type { Thing } from "./a.ts";\nexport class Things {\n    next(): Thing { return { x: 1 }; }\n}',
    });
    const facts = readFile(made.context, made.source("a.sim.ts"), "a.sim.ts");
    made.remove();
    const found = facts.factories.find((one) => one.method === "next");
    assert.equal(found?.key, "a.ts#Thing");
    assert.equal(found?.exportName, "Things");
});

test("a function returning a type from outside the project is no factory", () => {
    const made = fixture({ "a.sim.ts": "export function aDate(): Date { return new Date(); }" });
    const facts = readFile(made.context, made.source("a.sim.ts"), "a.sim.ts");
    made.remove();
    assert.deepEqual(facts.factories, []);
});

test("a function taking the injector is a scenario, whatever it is called", () => {
    const made = fixture({
        "a.sim.ts":
            'import type { Checklist, Injector } from "faultline";\nexport function anything(i: Injector, c: Checklist) { void i; void c; }',
        "node_modules/faultline/package.json": '{ "name": "faultline", "type": "module", "exports": "./index.ts" }',
        "node_modules/faultline/index.ts": "export interface Injector { y: number }\nexport interface Checklist { z: number }",
    });
    made.context.runtimeFile = [`${made.root}/node_modules/faultline/index.ts`];
    const facts = readFile(made.context, made.source("a.sim.ts"), "a.sim.ts");
    made.remove();
    assert.equal(facts.scenarios.length, 1);
    assert.equal(facts.scenarios[0]?.exportName, "anything");
});

test("a function taking nothing and giving nothing back is an invariant, not a scenario", () => {
    const made = fixture({
        "a.sim.ts": "export function itHolds(): void {}",
        "node_modules/faultline/package.json": '{ "name": "faultline", "type": "module", "exports": "./index.ts" }',
        "node_modules/faultline/index.ts": "export interface Injector { y: number }",
    });
    made.context.runtimeFile = [`${made.root}/node_modules/faultline/index.ts`];
    const facts = readFile(made.context, made.source("a.sim.ts"), "a.sim.ts");
    made.remove();
    assert.deepEqual(facts.scenarios, []);
    assert.equal(facts.invariants.length, 1);
    assert.equal(facts.invariants[0]?.exportName, "itHolds");
});

test("a function that takes no subject is neither a scenario nor an invariant", () => {
    const made = fixture({ "a.sim.ts": "export function notAScenario(a: number) { return a; }" });
    const facts = readFile(made.context, made.source("a.sim.ts"), "a.sim.ts");
    made.remove();
    assert.deepEqual(facts.scenarios, []);
    assert.deepEqual(facts.invariants, []);
});

test("a file with no function in it reads as having none", () => {
    const facts = read("export const a = 1;\nexport interface B { x: number }");
    assert.deepEqual(facts.functions, []);
});

test("a function written inside another says which one it is inside", () => {
    const facts = read("export function outer() { function inner() {} return inner; }");
    assert.equal(facts.functions.find((one) => one.label === "inner")?.within, "outer");
});

test("a function at the top of a file is inside no other", () => {
    const facts = read("export function alone() {}");
    assert.equal(facts.functions[0]?.within, undefined);
});

test("a function two deep names the one directly around it", () => {
    const facts = read("export function outer() { function middle() { function inner() {} return inner; } return middle; }");
    assert.equal(facts.functions.find((one) => one.label === "inner")?.within, "middle");
});
