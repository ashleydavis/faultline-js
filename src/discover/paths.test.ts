import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "../testing.ts";
import { pathsIn, type PathSite } from "./paths.ts";

// Every path one piece of text holds.
function read(text: string): PathSite[] {
    return pathsIn(parse(text), "example.ts").paths;
}

// The names of those paths.
function names(text: string): string[] {
    return read(text).map((one) => one.name);
}

test("a function with no branch has one path, its body", () => {
    assert.deepEqual(names("export function f() { return 1; }"), ["f:entered"]);
});

test("a path knows the line it is on", () => {
    const paths = read("export function f(a: number) {\n    if (a) {\n        return 1;\n    }\n    return 2;\n}");
    assert.equal(paths.find((one) => one.name === "if:2:true")?.line, 2);
});

test("a path points at the first statement of the body it stands for", () => {
    const paths = read("export function f(a: number) {\n    if (a) {\n        return 1;\n    }\n    return 2;\n}");
    assert.deepEqual(paths.find((one) => one.name === "if:2:true")?.at, { line: 3, column: 8 });
});

test("an if has a true side and a false side", () => {
    assert.deepEqual(names("export function f(a: number) { if (a) { return 1; } return 2; }"), [
        "f:entered",
        "if:1:true",
        "if:1:false",
    ]);
});

test("the false side of an if is counted against the if itself running", () => {
    const paths = read("export function f(a: number) { if (a) { return 1; } return 2; }");
    const other = paths.find((one) => one.name === "if:1:false")!;
    const taken = paths.find((one) => one.name === "if:1:true")!;
    assert.deepEqual(other.against, taken.at);
});

test("a catch is a path of its own", () => {
    assert.ok(names("export function f() { try { g(); } catch { return 1; } return 2; }").includes("catch:1"));
});

test("an if with a written else still has the same two paths", () => {
    assert.deepEqual(names("export function f(a: number) { if (a) { return 1; } else { return 2; } }"), [
        "f:entered",
        "if:1:true",
        "if:1:false",
    ]);
});

test("an else if is reported by the nested if, not twice", () => {
    assert.deepEqual(names("export function f(a: number) { if (a) { return 1; } else if (a > 2) { return 2; } return 3; }"), [
        "f:entered",
        "if:1:true",
        "if:1:false",
        "if:1:true",
        "if:1:false",
    ]);
});

test("a conditional has both of its sides", () => {
    assert.deepEqual(names("export const f = (a: number) => a ? 1 : 2;"), [
        "f:entered",
        "ternary:1:true",
        "ternary:1:false",
    ]);
});

test("an operator that short circuits has the side it took and the side it skipped", () => {
    assert.deepEqual(names("export function f(a: number, b: number) { return a && b; }"), [
        "f:entered",
        "logic:1:&&:taken",
        "logic:1:&&:short",
    ]);
});

test("a short circuit inside a loop's own condition is left out, because V8 counts no condition", () => {
    const found = pathsIn(parse("export function f(a: number, b: number) {\n    while (a && b) {\n        a -= 1;\n    }\n}"), "example.ts");
    assert.equal(found.paths.some((one) => one.name.endsWith(":short")), false);
    assert.ok(found.paths.some((one) => one.name.endsWith(":taken")));
    assert.equal(found.unseen.length, 1);
    assert.match(found.unseen[0]!.describe, /short circuit/);
});

test("a short circuit outside a loop's condition is counted", () => {
    const found = pathsIn(parse("export function f(a: number, b: number) {\n    return a && b;\n}"), "example.ts");
    assert.ok(found.paths.some((one) => one.name.endsWith(":short")));
    assert.deepEqual(found.unseen, []);
});

test("or and the nullish operator are counted the same way", () => {
    assert.ok(names("export function f(a: number, b: number) { return a || b; }").includes("logic:1:||:taken"));
    assert.ok(names("export function f(a?: number, b?: number) { return a ?? b; }").includes("logic:1:??:taken"));
});

test("every arm of a switch is a path of its own", () => {
    const found = names(
        "export function f(a: number) {\n    switch (a) {\n        case 1:\n            return 1;\n        default:\n            return 2;\n    }\n}",
    );
    assert.deepEqual(found, ["f:entered", "case:3", "case:5:default"]);
});

test("an arm with no statement falls through and gets no path of its own", () => {
    const found = names(
        "export function f(a: number) {\n    switch (a) {\n        case 1:\n        case 2:\n            return 1;\n    }\n    return 0;\n}",
    );
    assert.deepEqual(found, ["f:entered", "case:4"]);
});

test("every kind of loop gets one path for its body", () => {
    const loops = [
        "for (let i = 0; i < 1; i += 1) { g(); }",
        "for (const x of []) { g(); }",
        "for (const x in {}) { g(); }",
        "while (a) { g(); }",
        "do { g(); } while (a);",
    ];
    for (const body of loops) {
        const found = names(`declare function g(): void;\nexport function f(a: number) {\n    ${body}\n}`);
        assert.ok(found.includes("loop:3:body"), body);
    }
});

test("a default on a parameter is a path of its own", () => {
    assert.ok(names("export function f(a = 2) { return a; }").includes("default:1:a"));
});

test("a function with an expression for a body still has one", () => {
    assert.ok(names("export const f = () => 1;").includes("f:entered"));
});

test("a callback belongs to the function that wrote it", () => {
    const paths = read("export function f(items: number[]) { return items.map((x) => x > 1 ? 1 : 2); }");
    for (const one of paths) {
        assert.equal(one.fn, "f");
    }
});

test("a method carries the name of the class it is on", () => {
    assert.deepEqual(names("export class C { m() { return 1; } }"), ["C.m:entered"]);
});

test("a nested branch is found however deep it is", () => {
    const found = names(
        "export function f(items: number[]) {\n    for (const x of items) {\n        if (x) {\n            return 1;\n        }\n    }\n    return 0;\n}",
    );
    assert.deepEqual(found, ["f:entered", "loop:2:body", "if:3:true", "if:3:false"]);
});

test("a file with no function has no path", () => {
    assert.deepEqual(read("export const a = 1;"), []);
});

test("every path names the file it was found in", () => {
    for (const one of read("export function f(a: number) { if (a) { return 1; } return 2; }")) {
        assert.equal(one.file, "example.ts");
    }
});

