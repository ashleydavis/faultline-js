import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { fixture } from "../testing.ts";
import { buildProgram, defaultOptions, formatDiagnostic, isModuleProject, optionsFor, stoppingErrors } from "./program.ts";

// Writes files into a directory of its own.
function directory(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "faultline-program-"));
    for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(root, name), text);
    }
    return root;
}

test("a project with no config of its own gets the defaults", () => {
    const root = directory({ "a.ts": "export const a = 1;" });
    const options = optionsFor(root);
    assert.equal(options.allowJs, defaultOptions.allowJs);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a project's own config decides the options", () => {
    const root = directory({
        "a.ts": "export const a = 1;",
        "tsconfig.json": '{ "compilerOptions": { "strict": true, "target": "ES2020" } }',
    });
    const options = optionsFor(root);
    assert.equal(options.strict, true);
    assert.equal(options.target, ts.ScriptTarget.ES2020);
    fs.rmSync(root, { recursive: true, force: true });
});

test("whatever the project emits for itself is turned off, because a run writes none of it", () => {
    const root = directory({
        "a.ts": "export const a = 1;",
        "tsconfig.json": '{ "compilerOptions": { "declaration": true, "composite": true, "outDir": "dist" } }',
    });
    const options = optionsFor(root);
    assert.equal(options.noEmit, true);
    assert.equal(options.declaration, false);
    assert.equal(options.composite, false);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a config that will not parse falls back to the defaults rather than stopping the run", () => {
    const root = directory({ "a.ts": "export const a = 1;", "tsconfig.json": "{ this is not json" });
    assert.equal(optionsFor(root).allowJs, true);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a program is built over the files it was given", () => {
    const root = directory({ "a.ts": "export const a = 1;" });
    const built = buildProgram(root, [path.join(root, "a.ts")]);
    assert.notEqual(built.program.getSourceFile(path.join(root, "a.ts")), undefined);
    assert.notEqual(built.checker, undefined);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a file that will not parse stops the run", () => {
    const made = fixture({ "a.ts": "export function f( {" });
    const found = stoppingErrors(made.built.program, made.root);
    made.remove();
    assert.ok(found.length > 0);
});

test("a type error does not stop the run, because the code still has paths to exercise", () => {
    const made = fixture({ "a.ts": "export const a: number = 'text';" });
    const found = stoppingErrors(made.built.program, made.root);
    made.remove();
    assert.deepEqual(found, []);
});

test("an error names the file, the line and the column", () => {
    const made = fixture({ "a.ts": "export function f( {" });
    const found = stoppingErrors(made.built.program, made.root);
    made.remove();
    assert.match(found[0]!, /^a\.ts:\d+:\d+: /);
});

test("an error with no file of its own is written as its message alone", () => {
    assert.equal(
        formatDiagnostic({ messageText: "said something", category: ts.DiagnosticCategory.Error, code: 1, file: undefined, start: undefined, length: undefined }, "/tmp"),
        "said something",
    );
});

test("a project with no manifest is taken as modules", () => {
    const root = directory({ "a.ts": "export const a = 1;" });
    assert.equal(isModuleProject(root), true);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a project whose manifest says modules is taken as modules", () => {
    const root = directory({ "package.json": '{ "type": "module" }' });
    assert.equal(isModuleProject(root), true);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a project whose manifest says otherwise is told so rather than left to fail one call at a time", () => {
    const root = directory({ "package.json": '{ "type": "commonjs" }' });
    assert.equal(isModuleProject(root), false);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a manifest that will not parse is taken as modules", () => {
    const root = directory({ "package.json": "{ not json" });
    assert.equal(isModuleProject(root), true);
    fs.rmSync(root, { recursive: true, force: true });
});
