//
// Checks the transformer that lets a scenario start a file as the process's entry point. The goal is
// that every reading of `import.meta.main` in a loaded copy also asks the run, and that nothing else
// changes. The method is to transpile small files with the transformer and read the output, and to
// run the expression it builds with stand-ins for the global and `import.meta`.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import { entryCheckName } from "../world/globals.ts";
import { checkEntryPoint, entryReading, isImportMetaMain } from "./entry-check.ts";

//
// What `text` transpiles to as an ES module with the transformer.
//
export function transpiledWithCheck(text: string): string {
    return ts.transpileModule(text, {
        fileName: "/p/src/index.ts",
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
        },
        transformers: {
            before: [checkEntryPoint],
        },
    }).outputText;
}

//
// The first expression statement of `text`'s expression.
//
export function firstExpression(text: string): ts.Expression {
    const statement = ts.createSourceFile("a.ts", text, ts.ScriptTarget.ES2022, true).statements[0];
    assert.ok(statement !== undefined && ts.isExpressionStatement(statement));
    return statement.expression;
}

describe("checkEntryPoint", () => {
    test("every reading of import.meta.main also asks the run, and the rest of the file is as it was", () => {
        const output = transpiledWithCheck([
            "if (import.meta.main) {",
            "    start();",
            "}",
            "const where = import.meta.url;",
            "const twice = import.meta.main && import.meta.main;",
            "",
        ].join("\n"));
        const asked = `(globalThis.${entryCheckName}?.(import.meta.url) || import.meta.main)`;
        assert.ok(output.includes(`if ${asked} {`) || output.includes(`if (${asked}) {`), output);
        assert.ok(output.includes(`const twice = ${asked} && ${asked};`), output);
        assert.ok(output.includes("const where = import.meta.url;"));
    });

    test("a file that never reads import.meta.main is not changed", () => {
        assert.equal(transpiledWithCheck("const main = 1;\nexport { main };\n").trim(), "const main = 1;\nexport { main };");
    });
});

describe("isImportMetaMain", () => {
    test("only import.meta.main is a reading of it", () => {
        assert.equal(isImportMetaMain(firstExpression("import.meta.main;")), true);
        assert.equal(isImportMetaMain(firstExpression("import.meta.url;")), false);
        assert.equal(isImportMetaMain(firstExpression("process.main;")), false);
        assert.equal(isImportMetaMain(firstExpression("new.target;")), false);
        assert.equal(isImportMetaMain(firstExpression("new.target.main;")), false);
        assert.equal(isImportMetaMain(firstExpression("main;")), false);
    });
});

describe("entryReading", () => {
    test("the expression is true when the run says the file was started, and Node's answer otherwise", () => {
        const printed = ts.createPrinter().printNode(ts.EmitHint.Expression, entryReading(ts.factory), ts.createSourceFile("a.ts", "", ts.ScriptTarget.ES2022));
        const runnable = printed.replaceAll("import.meta", "meta");
        const evaluate = new Function("globalThis", "meta", `return ${runnable};`);
        const started = {
            [entryCheckName]: (url: string) => url === "file:///p/src/index.ts?flt=3",
        };
        assert.equal(evaluate(started, { url: "file:///p/src/index.ts?flt=3", main: false }), true);
        assert.equal(evaluate(started, { url: "file:///p/src/other.ts?flt=3", main: false }), false);
        assert.equal(evaluate({}, { url: "file:///p/src/index.ts", main: true }), true);
    });
});
