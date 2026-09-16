import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { fixture } from "../testing.ts";
import { emit, isUnder, makeWorkDirectory, moduleNameFor, namesAnAsset, relativeSpecifier, toRelative, transpile } from "./emit.ts";

test("a rewritten copy keeps the file's place in the tree and is a module", () => {
    assert.equal(moduleNameFor("src/a.ts"), "src/a.mjs");
    assert.equal(moduleNameFor("a.tsx"), "a.mjs");
    assert.equal(moduleNameFor("a"), "a.mjs");
});

test("one copy's path from another is written the way a specifier has to be", () => {
    assert.equal(relativeSpecifier("/w/a.mjs", "/w/b.mjs"), "./b.mjs");
    assert.equal(relativeSpecifier("/w/deep/a.mjs", "/w/b.mjs"), "../b.mjs");
});

test("a file inside the root is told from one outside it", () => {
    assert.equal(isUnder("/root", "/root/a.ts"), true);
    assert.equal(isUnder("/root", "/root/deep/a.ts"), true);
    assert.equal(isUnder("/root", "/elsewhere/a.ts"), false);
    assert.equal(isUnder("/root", "/root"), false);
});

test("a path relative to the root is written the one way", () => {
    assert.equal(toRelative("/root", "/root/deep/a.ts"), "deep/a.ts");
});

test("the work directory is outside the project, so a run writes nothing into it", () => {
    const made = fixture({ "a.ts": "export const a = 1;" });
    const work = makeWorkDirectory(made.root);
    assert.equal(isUnder(made.root, work), false);
    assert.ok(fs.existsSync(path.join(work, "package.json")));
    fs.rmSync(work, { recursive: true, force: true });
    made.remove();
});

test("a copy carries a map back to the source it was rewritten from", () => {
    const made = fixture({ "a.ts": "export function f() {\n    return 1;\n}\n" });
    const done = emit({
        root: made.root,
        program: made.built.program,
        options: made.built.options,
        measured: new Set(["a.ts"]),
    });
    assert.match(fs.readFileSync(done.modules.get("a.ts")!, "utf8"), /sourceMappingURL=data:application\/json/);
    fs.rmSync(done.work, { recursive: true, force: true });
    made.remove();
});

test("a stylesheet, an image and a bundler's query all name an asset", () => {
    for (const one of ["./a.css", "./a.module.scss", "../x/y.svg", "./logo.png?url", "./a.txt?raw", "./f.woff2"]) {
        assert.equal(namesAnAsset(one), true, one);
    }
});

test("code names no asset, whatever it is written as", () => {
    for (const one of ["./a.ts", "./a.tsx", "./a.mjs", "./a.json", "react", "node:fs", "./a", "../b"]) {
        assert.equal(namesAnAsset(one), false, one);
    }
});

test("a stylesheet the code under test imports stands in as an empty module", () => {
    const made = fixture({ "a.ts": 'import "./a.css";\nexport function f() {\n    return 1;\n}\n' });
    fs.writeFileSync(path.join(made.root, "a.css"), "body { margin: 0 }\n");
    const done = emit({
        root: made.root,
        program: made.built.program,
        options: made.built.options,
        measured: new Set(["a.ts"]),
    });
    const text = fs.readFileSync(done.modules.get("a.ts")!, "utf8");
    assert.match(text, /__faultline-asset\.mjs/);
    assert.equal(text.includes("a.css"), false);
    fs.rmSync(done.work, { recursive: true, force: true });
    made.remove();
});

test("a transpile takes the types out and leaves the code", () => {
    const out = transpile("export const a: number = 1;", "a.ts", { module: ts.ModuleKind.ESNext });
    assert.match(out, /export const a = 1/);
    assert.equal(out.includes(": number"), false);
});

test("every file under the root is copied, and the run can find each one", () => {
    const made = fixture({ "a.ts": "export const a = 1;", "deep/b.ts": "export const b = 2;" });
    const done = emit({
        root: made.root,
        program: made.built.program,
        options: made.built.options,
        measured: new Set(["a.ts", "deep/b.ts"]),
    });
    assert.ok(fs.existsSync(done.modules.get("a.ts")!));
    assert.ok(fs.existsSync(done.modules.get("deep/b.ts")!));
    fs.rmSync(done.work, { recursive: true, force: true });
    made.remove();
});

test("a measured file reports its paths and a file left out reports none", () => {
    const made = fixture({ "a.ts": "export function f() { return 1; }", "b.ts": "export function g() { return 2; }" });
    const done = emit({
        root: made.root,
        program: made.built.program,
        options: made.built.options,
        measured: new Set(["a.ts"]),
    });
    assert.equal(done.paths.get("a.ts")?.length, 1);
    assert.equal(done.paths.get("b.ts"), undefined);
    fs.rmSync(done.work, { recursive: true, force: true });
    made.remove();
});

test("one file importing another is pointed at the copy rather than the original", () => {
    const made = fixture({
        "a.ts": 'import { b } from "./b.ts";\nexport function f() { return b; }',
        "b.ts": "export const b = 2;",
    });
    const done = emit({
        root: made.root,
        program: made.built.program,
        options: made.built.options,
        measured: new Set(["a.ts", "b.ts"]),
    });
    const written = fs.readFileSync(done.modules.get("a.ts")!, "utf8");
    assert.match(written, /from ["']\.\/b\.mjs["']/);
    fs.rmSync(done.work, { recursive: true, force: true });
    made.remove();
});

test("a copy of a measured file loads and runs", async () => {
    const made = fixture({ "a.ts": "export function f(x: number) { if (x > 1) { return 1; } return 0; }" });
    const done = emit({
        root: made.root,
        program: made.built.program,
        options: made.built.options,
        measured: new Set(["a.ts"]),
    });
    const loaded = (await import(done.modules.get("a.ts")!)) as { f: (x: number) => number };
    assert.equal(loaded.f(5), 1);
    fs.rmSync(done.work, { recursive: true, force: true });
    made.remove();
});

test("a copy carries no counter of its own, because V8 does the counting", () => {
    const made = fixture({ "a.ts": "export function f() { return 1; }" });
    const done = emit({
        root: made.root,
        program: made.built.program,
        options: made.built.options,
        measured: new Set(["a.ts"]),
    });
    const text = fs.readFileSync(done.modules.get("a.ts")!, "utf8");
    assert.equal(text.includes("__fltMark"), false);
    assert.match(text, /export function f\(\) \{\s*return 1;/);
    fs.rmSync(done.work, { recursive: true, force: true });
    made.remove();
});
