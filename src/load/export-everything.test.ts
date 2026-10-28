//
// Tests the transformer that exports every top-level declaration of a project file. Each test
// transpiles a small piece of TypeScript with the transformer, then reads which names the output
// exports, and the line tests read the inline source map to check every declaration still maps to
// the line it was written on.
//

import assert from "node:assert/strict";
import vm from "node:vm";
import { describe, test } from "@jest/globals";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import ts from "typescript";
import { addDeclarationExports, declaredNames, exportEverything, exportedNames, isExportable, withExport } from "./export-everything.ts";

//
// The output of transpiling `text` as an ES module, with or without the transformer.
//
export function transpiled(text: string, transform: boolean): string {
    return transpiledAs(text, transform, ts.ModuleKind.ESNext);
}

//
// The output of transpiling `text` as a module of the kind `module`, with or without the
// transformer.
//
export function transpiledAs(text: string, transform: boolean, module: ts.ModuleKind): string {
    return ts.transpileModule(text, {
        fileName: "example.ts",
        reportDiagnostics: false,
        compilerOptions: {
            module,
            target: ts.ScriptTarget.ES2022,
            inlineSourceMap: true,
        },
        transformers: {
            before: transform ? [exportEverything] : [],
        },
    }).outputText;
}

//
// The names an ES module's text exports, read by parsing it.
//
export function exportsOf(output: string): string[] {
    return [...exportedNames(ts.createSourceFile("out.js", output, ts.ScriptTarget.Latest, true))].sort();
}

//
// The first statement of a piece of TypeScript.
//
export function firstStatement(text: string): ts.Statement {
    const statement = ts.createSourceFile("example.ts", text, ts.ScriptTarget.Latest, true).statements[0];
    assert(statement !== undefined);
    return statement;
}

//
// The line, counted from 1, that the first appearance of `name` in the output maps back to.
//
export function originalLine(output: string, name: string): number {
    const encoded = output.slice(output.indexOf("base64,") + "base64,".length).trim();
    const map = new TraceMap(Buffer.from(encoded, "base64").toString("utf8"));
    const lines = output.split("\n");
    const lineIndex = lines.findIndex((line) => line.includes(name));
    assert(lineIndex >= 0, `${name} is not in the output.`);
    const line = lines[lineIndex];
    assert(line !== undefined);
    const found = originalPositionFor(map, {
        line: lineIndex + 1,
        column: line.indexOf(name),
    });
    assert(found.line !== null, `${name} maps back to no line.`);
    return found.line;
}

//
// One declaration and what it prints as once `export` is put on it.
//
interface IPrintCase {
    //
    // The declaration as written.
    //
    text: string;

    //
    // What the printed declaration starts with.
    //
    expected: RegExp;
}

describe("exportEverything", () => {
    test("private functions, classes and variables are exported", () => {
        const output = transpiled([
            "function hidden(value: number): number { return value; }",
            "async function waited(): Promise<void> {}",
            "function* counted(): Generator<number> { yield 1; }",
            "class Secret {}",
            "const kept = 1;",
            "let changed = 2;",
            "var old = 3;",
            "const { left, inner: { right }, ...rest } = { left: 1, inner: { right: 2 }, other: 3 };",
            "const [first, , third] = [1, 2, 3];",
        ].join("\n"), true);
        assert.deepEqual(exportsOf(output), [
            "Secret",
            "changed",
            "counted",
            "first",
            "hidden",
            "kept",
            "left",
            "old",
            "rest",
            "right",
            "third",
            "waited",
        ]);
    });

    test("CommonJS output exports private functions, classes and variables too", () => {
        const output = transpiledAs([
            "import { join } from \"node:path\";",
            "function hidden(): string { return join(\"a\", \"b\"); }",
            "class Secret {}",
            "const kept = 1;",
        ].join("\n"), true, ts.ModuleKind.CommonJS);
        assert.match(output, /exports\.hidden = hidden;/);
        assert.match(output, /exports\.Secret = Secret;/);
        assert.match(output, /const kept = 1;/);
        assert.match(output, /exports\.kept = kept;/);
        assert.equal(originalLine(output, "function hidden"), 2);
        assert.equal(originalLine(output, "class Secret"), 3);
        assert.equal(originalLine(output, "const kept"), 4);
    });

    test("a private variable the rest of a CommonJS file reads is still there under its own name", () => {
        const output = transpiledAs([
            "const limit = 3;",
            "export function capped(value: number): number {",
            "    return Math.min(value, limit);",
            "}",
        ].join("\n"), true, ts.ModuleKind.CommonJS);
        const loaded: Record<string, unknown> = {};
        vm.runInNewContext(output, {
            exports: loaded,
        });
        const capped = loaded.capped;
        assert.ok(typeof capped === "function");
        assert.equal(Reflect.apply(capped, undefined, [10]), 3);
        assert.equal(loaded.limit, 3);
    });

    test("without the transformer nothing private is exported", () => {
        assert.deepEqual(exportsOf(transpiled("function hidden(): void {}\nconst kept = 1;\n", false)), []);
    });

    test("a name the file already exports is not exported again, and a local name exported under another one still is", () => {
        const output = transpiled([
            "export function open(): void {}",
            "export default function main(): void {}",
            "function listed(): void {}",
            "const renamed = 1;",
            "function alias(): void {}",
            "export { listed, renamed as alias };",
        ].join("\n"), true);
        assert.deepEqual(exportsOf(output), ["alias", "default", "listed", "open", "renamed"]);
        assert.doesNotMatch(output, /export function listed/);
        assert.doesNotMatch(output, /export function alias/);
        assert.match(output, /export \{ renamed \};/);
    });

    test("an exported interface does not stop a constant of the same name being exported", () => {
        const output = transpiled("export interface Limits { most: number }\nconst Limits = { most: 1 };\n", true);
        assert.deepEqual(exportsOf(output), ["Limits"]);
    });

    test("every line keeps the place it had in the source", () => {
        const text = [
            "import type { Thing } from \"./thing.ts\";",
            "",
            "interface Square { side: number }",
            "",
            "function hidden(value: Square): number {",
            "    return value.side;",
            "}",
            "",
            "type Unused = string;",
            "const kept: Thing | undefined = undefined;",
            "",
            "class Secret {",
            "    reveal(): string {",
            "        return \"secret\";",
            "    }",
            "}",
        ].join("\n");
        const output = transpiled(text, true);
        assert.match(output, /export function hidden/);
        assert.equal(originalLine(output, "hidden"), 5);
        assert.equal(originalLine(output, "return value.side"), 6);
        assert.equal(originalLine(output, "kept"), 10);
        assert.equal(originalLine(output, "Secret"), 12);
        assert.equal(originalLine(output, "\"secret\""), 14);
    });
});

describe("isExportable", () => {
    test("a named declaration with no export is exportable", () => {
        assert.equal(isExportable(firstStatement("function hidden() {}")), true);
        assert.equal(isExportable(firstStatement("class Secret {}")), true);
        assert.equal(isExportable(firstStatement("const kept = 1;")), true);
    });

    test("an exported, declared or unnamed declaration is not", () => {
        assert.equal(isExportable(firstStatement("export function open() {}")), false);
        assert.equal(isExportable(firstStatement("export const open = 1;")), false);
        assert.equal(isExportable(firstStatement("declare function outside(): void;")), false);
        assert.equal(isExportable(firstStatement("declare const outside: number;")), false);
        assert.equal(isExportable(firstStatement("export default function () {}")), false);
        assert.equal(isExportable(firstStatement("export default class {}")), false);
    });

    test("a statement that declares nothing is not", () => {
        assert.equal(isExportable(firstStatement("call();")), false);
        assert.equal(isExportable(firstStatement("import fs from \"node:fs\";")), false);
        assert.equal(isExportable(firstStatement("interface Square {}")), false);
    });
});

describe("declaredNames", () => {
    test("a function and a class declare their names", () => {
        assert.deepEqual(declaredNames(firstStatement("function hidden() {}")), ["hidden"]);
        assert.deepEqual(declaredNames(firstStatement("class Secret {}")), ["Secret"]);
    });

    test("a variable statement declares every name it binds", () => {
        const names = declaredNames(firstStatement("const one = 1, { two, deep: [three, , ...four] } = value;"));
        assert.deepEqual(names.sort(), ["four", "one", "three", "two"]);
    });
});

describe("exportedNames", () => {
    test("every way a file exports a name is read", () => {
        const sourceFile = ts.createSourceFile("example.ts", [
            "export function open() {}",
            "export class Door {}",
            "export const { key } = value;",
            "export { listed, inner as outer };",
            "export * from \"./other.ts\";",
            "export interface Square {}",
        ].join("\n"), ts.ScriptTarget.Latest, true);
        assert.deepEqual([...exportedNames(sourceFile)].sort(), ["Door", "key", "listed", "open", "outer"]);
    });

    test("a default export is read as default", () => {
        for (const text of ["export default function main() {}", "export default class {}", "export default 1;"]) {
            const sourceFile = ts.createSourceFile("example.ts", text, ts.ScriptTarget.Latest, true);
            assert.deepEqual([...exportedNames(sourceFile)], ["default"]);
        }
    });
});

describe("addDeclarationExports", () => {
    test("only a declaration written with export adds names", () => {
        const names = new Set<string>();
        addDeclarationExports(firstStatement("call();"), names);
        addDeclarationExports(firstStatement("function hidden() {}"), names);
        addDeclarationExports(firstStatement("export enum Colour { Red }"), names);
        assert.deepEqual([...names], []);
        addDeclarationExports(firstStatement("export const one = 1, two = 2;"), names);
        addDeclarationExports(firstStatement("export default class {}"), names);
        assert.deepEqual([...names].sort(), ["default", "one", "two"]);
    });
});

describe("withExport", () => {
    test("export goes ahead of async and decorators", () => {
        const printer = ts.createPrinter();
        const cases: IPrintCase[] = [
            {
                text: "async function waited() {}",
                expected: /^export async function waited/,
            },
            {
                text: "@sealed class Secret {}",
                expected: /^export\s+@sealed\s+class Secret/,
            },
        ];
        for (const { text, expected } of cases) {
            const statement = firstStatement(text);
            const changed = withExport(statement, ts.factory);
            assert.match(printer.printNode(ts.EmitHint.Unspecified, changed, statement.getSourceFile()), expected);
        }
    });

    test("a variable statement is not given export in front of it, because it is exported by a list", () => {
        assert.throws(() => withExport(firstStatement("let changed = 1;"), ts.factory), /Only a function or a class/);
    });
});
