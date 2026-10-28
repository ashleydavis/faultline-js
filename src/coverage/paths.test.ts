//
// Checks every code path the path finder reads out of a file: the kinds of branch, where each sits,
// the top level of the file and the branches V8 gives no count for. Each test parses a small piece
// of text in memory and compares the paths found with the paths written out.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { parse } from "../discover/fixture.test.ts";
import { topLevelLabel } from "../discover/functions.ts";
import ts from "typescript";
import { hasOwnAwait, isBefore, isErasedStatement, isInStretch, pastTheQuestion, pathsIn, type Paths, type PathSite } from "./paths.ts";

// Every path one piece of text holds.
function read(text: string): PathSite[] {
    return pathsIn(parse(text), "example.ts").paths;
}

// The names of those paths.
function names(text: string): string[] {
    return read(text).map((one) => one.name);
}

// Everything one piece of text holds, the branches V8 reports no count for included.
function whole(text: string): Paths {
    return pathsIn(parse(text), "example.ts");
}

test("a function with no branch has one path, its body", () => {
    assert.deepEqual(names("export function f() { return 1; }"), ["(top level):entered", "f:entered"]);
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
        "(top level):entered",
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
        "(top level):entered",
        "f:entered",
        "if:1:true",
        "if:1:false",
    ]);
});

test("an else if is reported by the nested if, not twice", () => {
    assert.deepEqual(names("export function f(a: number) { if (a) { return 1; } else if (a > 2) { return 2; } return 3; }"), [
        "(top level):entered",
        "f:entered",
        "if:1:true",
        "if:1:false",
        "if:1:true#2",
        "if:1:false#2",
    ]);
});

test("a conditional has both of its sides", () => {
    assert.deepEqual(names("export const f = (a: number) => a ? 1 : 2;"), [
        "(top level):entered",
        "f:entered",
        "ternary:1:true",
        "ternary:1:false",
    ]);
});

test("an operator that short circuits has the side it took and the side it skipped", () => {
    assert.deepEqual(names("export function f(a: number, b: number) { return a && b; }"), [
        "(top level):entered",
        "f:entered",
        "logic:1:&&:taken",
        "logic:1:&&:short",
    ]);
});

test("a short circuit inside a loop's own condition is left out, because V8 counts no condition", () => {
    const found = pathsIn(parse("export function f(a: number, b: number) {\n    while (a && b) {\n        a -= 1;\n    }\n}"), "example.ts");
    assert.equal(found.paths.some((one) => one.name.endsWith(":short")), false);
    assert.ok(found.paths.some((one) => one.name.endsWith(":taken")));
    assert.equal(found.notProvable.length, 1);
    assert.match(found.notProvable[0]!.describe, /short circuit/);
});

test("a short circuit outside a loop's condition is counted", () => {
    const found = pathsIn(parse("export function f(a: number, b: number) {\n    return a && b;\n}"), "example.ts");
    assert.ok(found.paths.some((one) => one.name.endsWith(":short")));
    assert.deepEqual(found.notProvable, []);
});

test("or and the nullish operator are counted the same way", () => {
    assert.ok(names("export function f(a: number, b: number) { return a || b; }").includes("logic:1:||:taken"));
    assert.ok(names("export function f(a?: number, b?: number) { return a ?? b; }").includes("logic:1:??:taken"));
});

test("every arm of a switch is a path of its own", () => {
    const found = names(
        "export function f(a: number) {\n    switch (a) {\n        case 1:\n            return 1;\n        default:\n            return 2;\n    }\n}",
    );
    assert.deepEqual(found, ["(top level):entered", "f:entered", "case:3", "case:5:default"]);
});

test("an arm with no statement falls through and gets no path of its own", () => {
    const found = names(
        "export function f(a: number) {\n    switch (a) {\n        case 1:\n        case 2:\n            return 1;\n    }\n    return 0;\n}",
    );
    assert.deepEqual(found, ["(top level):entered", "f:entered", "case:4"]);
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

test("a default on a parameter is not provable, because V8 counts it as part of the function", () => {
    const found = whole("export function f(a = 2) { return a; }");
    assert.equal(found.paths.some((one) => one.name.startsWith("default:")), false);
    assert.deepEqual(found.notProvable, [
        {
            name: "default:1:a",
            file: "example.ts",
            line: 1,
            fn: "f",
            describe: "the default for `a`",
        },
    ]);
});

test("a function with an expression for a body still has one", () => {
    assert.ok(names("export const f = () => 1;").includes("f:entered"));
});

test("a callback belongs to the function that wrote it", () => {
    const paths = read("export function f(items: number[]) { return items.map((x) => x > 1 ? 1 : 2); }");
    for (const one of paths.filter((path) => path.name !== "(top level):entered")) {
        assert.equal(one.fn, "f");
    }
});

test("a name given twice in one file is made unique, so every path is counted on its own", () => {
    assert.deepEqual(names("export function f(items: number[]) { if (items) { return 1; } if (items) { return 2; } return items.map((x) => x); }"), [
        "(top level):entered",
        "f:entered",
        "if:1:true",
        "if:1:false",
        "if:1:true#2",
        "if:1:false#2",
        "f:entered#2",
    ]);
});

test("a method carries the name of the class it is on", () => {
    assert.deepEqual(names("export class C { m() { return 1; } }"), ["(top level):entered", "C.m:entered"]);
});

test("a nested branch is found however deep it is", () => {
    const found = names(
        "export function f(items: number[]) {\n    for (const x of items) {\n        if (x) {\n            return 1;\n        }\n    }\n    return 0;\n}",
    );
    assert.deepEqual(found, ["(top level):entered", "f:entered", "loop:2:body", "if:3:true", "if:3:false"]);
});

test("a file with no function has one path, its top level, entered at its first statement left in the loaded code", () => {
    const paths = read("declare const b: number;\nexport const a = 1;");
    assert.deepEqual(paths.map((one) => [one.name, one.fn, one.at]), [["(top level):entered", topLevelLabel, { line: 2, column: 0 }]]);
});

test("an empty file has no path at all, having no statement to run", () => {
    assert.deepEqual(read(""), []);
});

test("a branch outside every function belongs to the top level, under the label the function list gives it", () => {
    const paths = read("declare const a: number;\nexport const b = a ? 1 : 2;\nexport function f() { return 1; }");
    assert.deepEqual(paths.filter((one) => one.fn === topLevelLabel).map((one) => one.name), [
        "(top level):entered",
        "ternary:2:true",
        "ternary:2:false",
    ]);
    assert.deepEqual(paths.filter((one) => one.fn === "f").map((one) => one.name), ["f:entered"]);
});

test("a path V8 can count nowhere carries the name a provable path would", () => {
    const found = whole("export function f(a: number, b: number) {\n    while (a && b) {\n        a -= 1;\n    }\n}");
    assert.deepEqual(found.notProvable, [
        {
            name: "logic:2:&&:short",
            file: "example.ts",
            line: 2,
            fn: "f",
            describe: "the short circuit of `&&`",
        },
    ]);
});

test("every path names the file it was found in", () => {
    for (const one of read("export function f(a: number) { if (a) { return 1; } return 2; }")) {
        assert.equal(one.file, "example.ts");
    }
});


test("a read through `?.` is two paths: the read and the one skipped", () => {
    const text = "export function f(x: { a?: string }) { return x?.a; }";
    assert.ok(names(text).some((one) => one.endsWith(":read")), names(text).join(","));
    assert.ok(names(text).some((one) => one.endsWith(":skipped")), names(text).join(","));
});

test("the read skipped at `?.` is counted against the expression being reached", () => {
    const skipped = read("export function f(x: { a?: string }) { return x?.a; }").find((one) => one.name.endsWith(":skipped"));
    assert.notEqual(skipped?.against, undefined);
});

test("two reads through `?.` on one line are two paths, not one", () => {
    const found = read("export function f(x: { a?: { b?: string } }) { return x?.a?.b; }");
    assert.equal(new Set(found.filter((one) => one.name.startsWith("chain:")).map((one) => one.name)).size, 4);
});

test("a call made through `?.` is counted the same way", () => {
    const text = "export function f(x: { go?: (n: number) => void }) { x?.go?.(1); }";
    assert.ok(names(text).some((one) => one.startsWith("chain:")), names(text).join(","));
});

test("a lookup made through `?.` is counted the same way", () => {
    const text = "export function f(x: string[] | undefined, at: number) { return x?.[at]; }";
    assert.ok(names(text).some((one) => one.startsWith("chain:")), names(text).join(","));
});

test("a read through `?.` in a loop's own condition is left out and said to be", () => {
    const found = whole("export function f(x: { a?: string } | undefined) { while (x?.a !== undefined) { break; } }");
    assert.equal(found.paths.some((one) => one.name.endsWith(":skipped")), false);
    assert.ok(found.notProvable.some((one) => one.describe.includes("?.")), JSON.stringify(found.notProvable));
});

test("an empty body stands at its own brace, having no statement to point at", () => {
    const paths = read("export function f(a: number) {\n    if (a) {}\n    return 2;\n}");
    assert.deepEqual(paths.find((one) => one.name === "if:2:true")?.at, { line: 2, column: 11 });
});

test("a body written without braces points at the statement itself", () => {
    const paths = read("export function f(a: number) {\n    if (a) return 1;\n    return 2;\n}");
    assert.deepEqual(paths.find((one) => one.name === "if:2:true")?.at, { line: 2, column: 11 });
});

test("a call made through `?.` with no arguments has no place past the question to count", () => {
    const found = names("export function f(x: { go?: () => void }) { x.go?.(); }");
    assert.equal(found.some((one) => one.startsWith("chain:")), false, found.join(","));
});

test("a short circuit in a for loop's condition is left out", () => {
    const found = whole("export function f(a: number, b: number) { for (let i = 0; a && b; i += 1) { break; } }");
    assert.equal(found.paths.some((one) => one.name.endsWith(":short")), false);
    assert.equal(found.notProvable.length, 1);
});

test("a short circuit in a for loop's step is left out", () => {
    const found = whole("export function f(a: number) { for (let i = 0; i < 2; i = i || a) { break; } }");
    assert.equal(found.paths.some((one) => one.name.endsWith(":short")), false);
    assert.equal(found.notProvable.length, 1);
});

test("a short circuit in a do loop's condition is left out", () => {
    const found = whole("export function f(a: number, b: number) { do { a -= 1; } while (a && b); }");
    assert.equal(found.paths.some((one) => one.name.endsWith(":short")), false);
    assert.equal(found.notProvable.length, 1);
});

test("a short circuit in the body of a loop is counted, not left out", () => {
    const found = whole("export function f(a: number, b: number) { while (a) { a = a && b; } for (;;) { b = a || b; } }");
    assert.equal(found.paths.filter((one) => one.name.endsWith(":short")).length, 2);
    assert.deepEqual(found.notProvable, []);
});

test("a short circuit at the top level of a file, outside every function, is counted", () => {
    const found = whole("declare const a: number;\nexport const b = a && 1;");
    assert.ok(found.paths.some((one) => one.name === "logic:2:&&:short"));
    assert.deepEqual(found.notProvable, []);
});

test("only a read, a lookup or a call has a place past the question", () => {
    const source = parse("export const a = 1;");
    assert.equal(pastTheQuestion(source), undefined);
});

describe("pathsIn at the top level of a file", () => {
    test("the top level is entered at its first statement left in the loaded code, past the types", () => {
        const paths = read("export interface A { a: number; }\ntype B = string;\nimport type { C } from \"./c.ts\";\nexport type { D } from \"./d.ts\";\ndeclare const e: number;\nexport const f = 1;");
        const top = paths.find((one) => one.name === "(top level):entered");
        assert.equal(top?.line, 6);
        assert.equal(paths.length, 1);
    });

    test("a file of types alone has no top-level path", () => {
        assert.deepEqual(names("export interface A { a: number; }\ntype B = string;"), []);
    });
});

describe("isErasedStatement", () => {
    test("only statements that hold types alone are erased", () => {
        const statements = parse("interface A {}\ntype B = 1;\nimport type { C } from \"./c.ts\";\nexport type { D } from \"./d.ts\";\ndeclare function e(): void;\nimport f from \"./f.ts\";\nexport { g } from \"./g.ts\";\nexport const h = 1;\nh;\nimport \"./i.ts\";\nconst j = 2;").statements;
        assert.deepEqual(statements.map((statement) => isErasedStatement(statement)), [true, true, true, true, true, false, false, false, false, false, false]);
    });
});

describe("code after an await in a side that may not run", () => {
    //
    // A function whose ternary has an `await` in each side, followed by a statement, an `if` whose
    // condition V8 miscounts and a later `if` it counts again, as measured against V8 itself.
    //
    const ternary = [
        "export async function f(a: boolean, b: string) {",
        "    const c = a ? await g(b) : await g(b);",
        "    const d = c + \"\";",
        "    if (d === \"stop\") {",
        "        return 1;",
        "    }",
        "    if (d === \"x\") {",
        "        return 2;",
        "    }",
        "    return 3;",
        "}",
    ].join("\n");

    test("a path placed between the end of the conditional and the next block is not provable", () => {
        const found = whole(ternary);
        assert.deepEqual(found.notProvable.map((one) => one.name), ["if:4:false"]);
        const kept = found.paths.map((one) => one.name);
        assert.ok(kept.includes("if:4:true"));
        assert.ok(kept.includes("if:7:true"));
        assert.ok(kept.includes("if:7:false"));
        assert.ok(kept.includes("ternary:2:false"));
    });

    test("a short circuit with an await on its right is treated the same way", () => {
        const found = whole("export async function f(a: boolean) {\n    const c = a && await g();\n    if (c) {\n        return 1;\n    }\n    return 2;\n}");
        assert.deepEqual(found.notProvable.map((one) => one.name), ["if:3:false"]);
    });

    test("a stretch ends at the first block after it, here the right side of a short circuit", () => {
        const found = whole("export async function f(a: boolean) {\n    const c = a ? await g() : 1;\n    return c ?? 2;\n}");
        assert.deepEqual(found.notProvable.map((one) => one.name), ["logic:3:??:short"]);
    });

    test("an await in a function written inside a side, or in no side, changes nothing", () => {
        const inner = whole("export async function f(a: boolean) {\n    const c = a ? async () => await g() : 1;\n    if (c) {\n        return 1;\n    }\n    return 2;\n}");
        const outside = whole("export async function f(a: boolean) {\n    const c = await g();\n    const d = a ? c : 1;\n    if (d) {\n        return 1;\n    }\n    return 2;\n}");
        assert.deepEqual(inner.notProvable, []);
        assert.deepEqual(outside.notProvable, []);
    });

    test("a stretch in one function leaves the paths of another alone", () => {
        const found = whole(`${ternary}\nexport function h(e: number) {\n    if (e) {\n        return 1;\n    }\n    return 2;\n}`);
        assert.deepEqual(found.notProvable.map((one) => one.name), ["if:4:false"]);
    });
});

describe("isBefore", () => {
    test("an earlier line, or an earlier column on the same line, comes before", () => {
        assert.equal(isBefore({ line: 1, column: 9 }, { line: 2, column: 0 }), true);
        assert.equal(isBefore({ line: 2, column: 1 }, { line: 2, column: 4 }), true);
        assert.equal(isBefore({ line: 2, column: 4 }, { line: 2, column: 4 }), false);
        assert.equal(isBefore({ line: 3, column: 0 }, { line: 2, column: 9 }), false);
    });
});

describe("hasOwnAwait", () => {
    test("an await of the function itself is found, and one in a function written inside it is not", () => {
        const source = parse("async function f() {\n    const a = await g() + 1;\n    const b = async () => await g();\n}");
        const statement = source.statements[0];
        assert.ok(statement !== undefined && ts.isFunctionDeclaration(statement));
        const [first, second] = statement.body!.statements;
        assert.ok(first !== undefined);
        assert.ok(second !== undefined);
        assert.equal(hasOwnAwait(first), true);
        assert.equal(hasOwnAwait(second), false);
    });
});

describe("isInStretch", () => {
    //
    // A path in `f` at `line` and column zero, counted against `against` when given.
    //
    function siteAt(name: string, line: number, against: number | undefined): PathSite {
        return {
            name,
            describe: name,
            file: "example.ts",
            line,
            fn: "f",
            at: { line, column: 0 },
            against: against === undefined ? undefined : { line: against, column: 0 },
        };
    }

    test("the stretch ends at the earliest block after it, whatever order the paths are listed in", () => {
        const stretch = { fn: "f", start: { line: 2, column: 0 } };
        const late = siteAt("late", 9, undefined);
        const early = siteAt("early", 5, undefined);
        const inside = siteAt("inside", 3, 5);
        const after = siteAt("after", 7, 9);
        const paths = [late, early, inside, after];
        assert.equal(isInStretch(paths, stretch, inside), true);
        assert.equal(isInStretch(paths, stretch, after), false);
        assert.equal(isInStretch(paths, stretch, early), false);
    });

    test("with no block after it the stretch runs to the end of the function", () => {
        const stretch = { fn: "f", start: { line: 2, column: 0 } };
        const before = siteAt("before", 1, undefined);
        const counted = siteAt("counted", 6, 1);
        assert.equal(isInStretch([before, counted], stretch, counted), true);
        assert.equal(isInStretch([before, counted], stretch, before), false);
    });
});
