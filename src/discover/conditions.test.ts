// Tests the reading of the conditions in a function, one test per kind of condition. Each test
// writes a small file into a project in memory, reads the conditions of one function in it through
// a real type checker and checks the line, kind, operator, value and subject read.

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import { conditionsIn, isUndefinedWritten, listOf, literalOf, skipParentheses } from "./conditions.ts";
import type { Condition } from "./conditions.ts";
import { fixture, parse } from "./fixture.test.ts";

// The function declared at the top of `source` under `name`, so a test reads the conditions of
// the one function it is about.
export function topLevelFunction(source: ts.SourceFile, name: string): ts.FunctionDeclaration {
    const found = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
    assert.ok(found !== undefined, `No function at the top of the file is called ${name}.`);
    assert.ok(found.body !== undefined, `The function ${name} has no body.`);
    return found;
}

// The conditions in the function called `name` at the top of a file written on the spot.
export async function conditionsOf(text: string, name: string): Promise<Condition[]> {
    const made = await fixture({
        "a.ts": text,
    });
    return conditionsIn(made.built.checker, topLevelFunction(made.source("a.ts"), name));
}

// The conditions at the top level of a file written on the spot.
export async function topLevelConditionsOf(text: string): Promise<Condition[]> {
    const made = await fixture({
        "a.ts": text,
    });
    return conditionsIn(made.built.checker, made.source("a.ts"));
}

// The first declaration of the variable statement at `index` in `source`.
export function declarationAt(source: ts.SourceFile, index: number): ts.VariableDeclaration {
    const statement = source.statements[index];
    assert.ok(statement !== undefined, `The file has no statement at ${index}.`);
    assert.ok(ts.isVariableStatement(statement), `The statement at ${index} declares no variable.`);
    const declaration = statement.declarationList.declarations[0];
    assert.ok(declaration !== undefined);
    return declaration;
}

describe("topLevelFunction", () => {
    test("the function with the name is found among the statements", () => {
        const source = parse("const a = 1;\nfunction g() {}\nfunction f() {}");
        assert.equal(topLevelFunction(source, "f").name?.text, "f");
        assert.equal(topLevelFunction(source, "g").name?.text, "g");
    });

    test("a name no function at the top of the file has is a programmer error", () => {
        assert.throws(() => topLevelFunction(parse("function f() {}"), "g"), /No function at the top of the file is called g/);
    });

    test("a function with no body is a programmer error", () => {
        assert.throws(() => topLevelFunction(parse("declare function f(): void;"), "f"), /has no body/);
    });
});

describe("declarationAt", () => {
    test("the declaration of the variable statement is read", () => {
        const source = parse("function f() {}\nconst held = 1;");
        assert.equal(declarationAt(source, 1).name.getText(source), "held");
    });

    test("a statement that declares no variable is a programmer error", () => {
        assert.throws(() => declarationAt(parse("function f() {}"), 0), /declares no variable/);
        assert.throws(() => declarationAt(parse("function f() {}"), 1), /no statement at 1/);
    });
});

describe("conditionsIn", () => {
    test("a comparison against a literal is read with its operator, value and subject", async () => {
        assert.deepEqual(await conditionsOf("export function f(x: number) {\n    if (x === 3) { return 1; }\n    return 0;\n}", "f"), [
            {
                line: 2,
                kind: "comparison",
                operator: "===",
                literal: {
                    kind: "number",
                    value: 3,
                },
                subject: "x",
            },
        ]);
    });

    test("every comparison operator is read", async () => {
        assert.deepEqual((await conditionsOf("export function f(x: number) { return [x === 1, x !== 2, x == 3, x != 4, x < 5, x <= 6, x > 7, x >= 8]; }", "f")).map((condition) => condition.operator), ["===", "!==", "==", "!=", "<", "<=", ">", ">="]);
    });

    test("a comparison with the literal on the left reads as if the literal were on the right", async () => {
        const found = await conditionsOf("export function f(x: number) { return [3 < x, 3 <= x, 3 > x, 3 >= x, 3 === x, 3 !== x, 3 == x, 3 != x]; }", "f");
        assert.deepEqual(found.map((condition) => condition.operator), [">", ">=", "<", "<=", "===", "!==", "==", "!="]);
        assert.ok(found.every((condition) => condition.subject === "x"));
    });

    test("a comparison with no literal on either side is not read", async () => {
        assert.deepEqual(await conditionsOf("export function f(x: number, y: number) { return [x < y, x + 1, x * y]; }", "f"), []);
    });

    test("a named constant gives its value, through the checker", async () => {
        assert.deepEqual((await conditionsOf('const limit = 10;\nconst mode = "fast";\nenum Level { Low = 1, High = 5 }\nexport function f(x: number, y: string, z: Level) { return [x > limit, y === mode, z === Level.High]; }', "f")).map((condition) => condition.literal), [
            {
                kind: "number",
                value: 10,
            },
            {
                kind: "string",
                value: "fast",
            },
            {
                kind: "number",
                value: 5,
            },
        ]);
    });

    test("strings, negative numbers, booleans, bigints, null and undefined are read as literals", async () => {
        assert.deepEqual((await conditionsOf('export function f(x: unknown) { return [x === "a", x === -1, x === true, x === false, x === 10n, x === -3n, x === null, x === undefined, x === void 0]; }', "f")).map((condition) => condition.literal), [
            {
                kind: "string",
                value: "a",
            },
            {
                kind: "number",
                value: -1,
            },
            {
                kind: "boolean",
                value: true,
            },
            {
                kind: "boolean",
                value: false,
            },
            {
                kind: "bigint",
                value: "10",
            },
            {
                kind: "bigint",
                value: "-3",
            },
            {
                kind: "null",
                value: undefined,
            },
            {
                kind: "undefined",
                value: undefined,
            },
            {
                kind: "undefined",
                value: undefined,
            },
        ]);
    });

    test("startsWith, endsWith and includes with a literal are read with the string they are called on", async () => {
        assert.deepEqual(await conditionsOf('export function f(name: string) { return [name.startsWith("x-"), name.endsWith(".ts"), name.includes("/")]; }', "f"), [
            {
                line: 1,
                kind: "starts-with",
                literal: {
                    kind: "string",
                    value: "x-",
                },
                subject: "name",
            },
            {
                line: 1,
                kind: "ends-with",
                literal: {
                    kind: "string",
                    value: ".ts",
                },
                subject: "name",
            },
            {
                line: 1,
                kind: "includes",
                literal: {
                    kind: "string",
                    value: "/",
                },
                subject: "name",
            },
        ]);
    });

    test("a call with no literal, a call of another method and a call with more arguments are not read", async () => {
        assert.deepEqual(await conditionsOf('export function f(name: string, other: string) { return [name.startsWith(other), name.indexOf("x"), name.includes("x", 2), check("x")]; }\nfunction check(value: string) { return value; }', "f"), []);
    });

    test("includes on a list of literals reads one condition per literal, with the value looked for as the subject", async () => {
        const found = await conditionsOf('const modes = ["fast", "slow"];\nexport function f(mode: string) { return [["a", "b", 3].includes(mode), modes.includes(mode)]; }', "f");
        assert.deepEqual(found.map((condition) => condition.literal?.value), ["a", "b", 3, "fast", "slow"]);
        assert.ok(found.every((condition) => condition.kind === "includes"));
        assert.ok(found.every((condition) => condition.subject === "mode"));
    });

    test("includes on a list of literals and other values reads only the literals", async () => {
        assert.deepEqual((await conditionsOf('export function f(mode: string, other: string) { return ["a", other, "b"].includes(mode); }', "f")).map((condition) => condition.literal?.value), ["a", "b"]);
    });

    test("includes on a list held by a variable that can change, or on something that is not a list, is not read", async () => {
        assert.deepEqual(await conditionsOf('let modes = ["fast"];\nconst count = 3;\nexport function f(mode: string, list: string[]) { return [modes.includes(mode), list.includes(mode), (count as unknown as string[]).includes(mode)]; }', "f"), []);
    });

    test("an in with a literal key is read with the object it looks in", async () => {
        assert.deepEqual(await conditionsOf('export function f(value: object) { return "name" in value; }', "f"), [
            {
                line: 1,
                kind: "in",
                literal: {
                    kind: "string",
                    value: "name",
                },
                subject: "value",
            },
        ]);
        assert.deepEqual(await conditionsOf("export function f(key: string, value: object) { return key in value; }", "f"), []);
    });

    test("each case of a switch with a literal is read on its own line", async () => {
        assert.deepEqual(await conditionsOf('export function f(x: string) {\n    switch (x) {\n        case "a":\n            return 1;\n        case "b":\n            return 2;\n        case String(3):\n            return 3;\n        default:\n            return 0;\n    }\n}', "f"), [
            {
                line: 3,
                kind: "case",
                literal: {
                    kind: "string",
                    value: "a",
                },
                subject: "x",
            },
            {
                line: 5,
                kind: "case",
                literal: {
                    kind: "string",
                    value: "b",
                },
                subject: "x",
            },
        ]);
    });

    test("a typeof check is read with its operand and the type name", async () => {
        assert.deepEqual(await conditionsOf('export function f(x: unknown) { return [typeof x === "string", "number" !== typeof x, (typeof x) == "bigint"]; }', "f"), [
            {
                line: 1,
                kind: "typeof",
                operator: "===",
                literal: {
                    kind: "string",
                    value: "string",
                },
                subject: "x",
            },
            {
                line: 1,
                kind: "typeof",
                operator: "!==",
                literal: {
                    kind: "string",
                    value: "number",
                },
                subject: "x",
            },
            {
                line: 1,
                kind: "typeof",
                operator: "==",
                literal: {
                    kind: "string",
                    value: "bigint",
                },
                subject: "x",
            },
        ]);
    });

    test("a switch on typeof reads each case as a typeof check", async () => {
        assert.deepEqual(await conditionsOf('export function f(x: unknown) {\n    switch (typeof x) {\n        case "string":\n            return 1;\n    }\n    return 0;\n}', "f"), [
            {
                line: 3,
                kind: "typeof",
                operator: "===",
                literal: {
                    kind: "string",
                    value: "string",
                },
                subject: "x",
            },
        ]);
    });

    test("an instanceof check is read with the class it tests against", async () => {
        assert.deepEqual(await conditionsOf("export function f(x: unknown) { return x instanceof Error; }", "f"), [
            {
                line: 1,
                kind: "instanceof",
                className: "Error",
                subject: "x",
            },
        ]);
    });

    test("conditions come in the order they are written, a case below the conditions in the cases above it", async () => {
        assert.deepEqual((await conditionsOf('export function f(x: string, y: number) {\n    switch (x) {\n        case "a":\n            if (y > 1) { return 1; }\n            return 2;\n        case "b":\n            return 3;\n    }\n    return y === 0;\n}', "f")).map((condition) => condition.line), [3, 4, 6, 9]);
    });

    test("the conditions of a function include those in the functions written inside it", async () => {
        assert.deepEqual((await conditionsOf('export function f(items: string[]) { return items.filter((item) => item === "keep"); }', "f")).map((condition) => condition.literal?.value), ["keep"]);
    });

    test("the conditions of a function leave out those of other functions in the file", async () => {
        assert.deepEqual((await conditionsOf("export function f(x: number) { return x > 1; }\nexport function g(x: number) { return x < 2; }", "g")).map((condition) => condition.operator), ["<"]);
    });

    test("the conditions at the top level of a file leave out every function body", async () => {
        assert.deepEqual(await topLevelConditionsOf('const mode = process.env.MODE;\nif (mode === "fast") { console.log(1); }\nexport function f(x: number) { return x > 1; }\nexport const g = (x: number) => x < 2;'), [
            {
                line: 2,
                kind: "comparison",
                operator: "===",
                literal: {
                    kind: "string",
                    value: "fast",
                },
                subject: "mode",
            },
        ]);
    });

    test("a parameter's default value is read with its function", async () => {
        assert.deepEqual((await conditionsOf("export function f(x: number, y = x > 3) { return y; }", "f")).map((condition) => condition.operator), [">"]);
    });

    test("reading the conditions of a function with no body is a programmer error", async () => {
        const made = await fixture({
            "a.ts": "export declare function f(x: number): void;",
        });
        const declaration = made.source("a.ts").statements[0];
        assert.ok(declaration !== undefined);
        assert.ok(ts.isFunctionDeclaration(declaration));
        assert.throws(() => conditionsIn(made.built.checker, declaration), /no body/);
    });

    test("a call returning undefined is not a literal undefined", async () => {
        assert.deepEqual(await conditionsOf("function nothing(): undefined { return undefined; }\nexport function f(x: unknown) { return x === nothing(); }", "f"), []);
    });
});

describe("skipParentheses", () => {
    test("brackets around an expression are taken off", () => {
        const source = parse("const a = ((x));");
        const initializer = declarationAt(source, 0).initializer;
        assert.ok(initializer !== undefined);
        assert.equal(skipParentheses(initializer).getText(source), "x");
    });

    test("an expression with no brackets around it is handed back as it is", () => {
        const initializer = declarationAt(parse("const a = x;"), 0).initializer;
        assert.ok(initializer !== undefined);
        assert.equal(skipParentheses(initializer), initializer);
    });
});

describe("isUndefinedWritten", () => {
    test("an expression is undefined written only when it is undefined itself or void", () => {
        const source = parse("undefined; void 0; nothing(); other;");
        const expressions = source.statements.filter(ts.isExpressionStatement).map((statement) => statement.expression);
        assert.equal(expressions.length, source.statements.length);
        assert.deepEqual(expressions.map((expression) => isUndefinedWritten(expression)), [true, true, false, false]);
    });
});

describe("listOf", () => {
    test("a list is read from a list written out, a constant holding one and a constant holding one cast to a type", async () => {
        const made = await fixture({
            "a.ts": 'const held = ["a"];\nconst cast = (["b"]) as string[];\nconst other = "c";\nexport const used = [["x"], held, cast, other, missing, other.length];\ndeclare const missing: string[];',
        });
        const source = made.source("a.ts");
        const initializer = declarationAt(source, 3).initializer;
        assert.ok(initializer !== undefined);
        assert.ok(ts.isArrayLiteralExpression(initializer));
        assert.deepEqual(initializer.elements.map((element) => listOf(made.built.checker, element)?.getText(source)), ['["x"]', '["a"]', '["b"]', undefined, undefined, undefined]);
    });
});

describe("literalOf", () => {
    test("an expression the checker knows no single value for is no literal", async () => {
        const made = await fixture({
            "a.ts": "export function f(x: number, y: string) { return [x, y]; }",
        });
        const returned = topLevelFunction(made.source("a.ts"), "f").body?.statements[0];
        assert.ok(returned !== undefined);
        assert.ok(ts.isReturnStatement(returned));
        assert.ok(returned.expression !== undefined);
        assert.ok(ts.isArrayLiteralExpression(returned.expression));
        assert.deepEqual(returned.expression.elements.map((element) => literalOf(made.built.checker, element)), [undefined, undefined]);
    });

    test("null is read as a literal of its own kind", async () => {
        const made = await fixture({
            "a.ts": "export function f() { return null; }",
        });
        const returned = topLevelFunction(made.source("a.ts"), "f").body?.statements[0];
        assert.ok(returned !== undefined);
        assert.ok(ts.isReturnStatement(returned));
        assert.ok(returned.expression !== undefined);
        assert.deepEqual(literalOf(made.built.checker, returned.expression), {
            kind: "null",
            value: undefined,
        });
    });
});
