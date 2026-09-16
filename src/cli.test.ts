import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

// Running the tool rather than calling into it is what these tests are for: a run loads code in a
// process of its own, and only starting it the way somebody starts it exercises that.
const started = promisify(execFile);

// Where this repository is, so a project a test writes can import the runtime the way a real one
// does.
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Writes a project of its own and hands back the directory it went into.
function project(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "faultline-cli-"));
    fs.writeFileSync(path.join(root, "package.json"), '{ "name": "under-test", "type": "module" }\n');
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.symlinkSync(here, path.join(root, "node_modules", "faultline"), "dir");
    for (const [name, text] of Object.entries(files)) {
        const full = path.join(root, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
    }
    return root;
}

// What one run printed and what it exited with.
async function flt(argv: string[]): Promise<{ status: number; text: string }> {
    const where = path.join(here, "bin", "flt.mjs");
    try {
        const done = await started(process.execPath, [where, ...argv], { maxBuffer: 32 * 1024 * 1024 });
        return { status: 0, text: `${done.stdout}${done.stderr}` };
    }
    catch (thrown) {
        const failed = thrown as { code?: number; stdout?: string; stderr?: string };
        return { status: failed.code ?? 1, text: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
    }
}

// Runs the tool over a project written on the spot, and throws the project away after.
async function over(files: Record<string, string>, extra: string[] = []): Promise<{ status: number; text: string }> {
    const root = project(files);
    try {
        return await flt([root, "--seeds", "8", ...extra]);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test("no argument prints what the tool does and exits zero", async () => {
    const run = await flt([]);
    assert.equal(run.status, 0);
    assert.match(run.text, /every code path/);
});

test("the version is printed on its own", async () => {
    const run = await flt(["--version"]);
    assert.equal(run.status, 0);
    assert.match(run.text, /^\d+\.\d+\.\d+$/m);
});

test("an option the tool has no name for is refused, and nothing is run", async () => {
    const run = await flt(["--made-up"]);
    assert.equal(run.status, 2);
    assert.match(run.text, /no option called/);
});

test("a function with no branch in it reaches every path", async () => {
    const run = await over({ "a.ts": "export function greet(name: string) {\n    return name.length;\n}\n" });
    assert.equal(run.status, 0);
    assert.match(run.text, /Coverage: 1 of 1 path, 100%\./);
});

test("both sides of an if are reached without anything being written for them", async () => {
    const run = await over({
        "a.ts": "export function classify(count: number) {\n    if (count === 0) {\n        return 'none';\n    }\n    return 'some';\n}\n",
    });
    assert.equal(run.status, 0);
    assert.match(run.text, /Coverage: 3 of 3 paths, 100%\./);
});

test("a branch that runs for one value only is reported, with what to do about it", async () => {
    const run = await over({
        "a.ts": "export function magic(word: string) {\n    if (word === 'the-one-word-no-run-makes-up') {\n        return true;\n    }\n    return false;\n}\n",
    });
    assert.equal(run.status, 1);
    assert.match(run.text, /MISS magic/);
    assert.match(run.text, /FAIL 1 code path that no call reached:/);
    assert.match(run.text, /Write a scenario reaching the true side of the if at a\.ts:2 in magic\./);
});

test("a scenario reaches the path no call made up gets to", async () => {
    const run = await over({
        "a.ts": "export function magic(word: string) {\n    if (word === 'the-one-word') {\n        return true;\n    }\n    return false;\n}\n",
        "a.sim.ts":
            'import type { Checklist, Injector, Subject } from "faultline";\nimport { magic } from "./a.ts";\nexport function reachIt(s: Subject, i: Injector, c: Checklist) {\n    void s; void i; void c;\n    if (!magic("the-one-word")) {\n        throw new Error("WrongAnswer");\n    }\n}\n',
    });
    assert.equal(run.status, 0);
    assert.match(run.text, /Coverage: 3 of 3 paths, 100%\./);
});

test("a scenario that says the answer is wrong stops the run and prints how to reproduce it", async () => {
    const run = await over({
        "a.ts": "export function two() {\n    return 2;\n}\n",
        "a.sim.ts":
            'import type { Checklist, Injector, Subject } from "faultline";\nimport { two } from "./a.ts";\nexport function wrong(s: Subject, i: Injector, c: Checklist) {\n    void s; void i; void c;\n    if (two() !== 3) {\n        throw new Error("CountedWrong");\n    }\n}\n',
    });
    assert.equal(run.status, 1);
    assert.match(run.text, /failed in a\.sim\.ts:3 wrong with Error: CountedWrong\./);
    assert.match(run.text, /Reproduce it with: flt --replay "seed=\d+"/);
});

test("a replay of a run that passed says so and exits zero", async () => {
    const root = project({ "a.ts": "export function greet(name: string) {\n    return name.length;\n}\n" });
    try {
        const run = await flt([root, "--replay", "seed=3"]);
        assert.equal(run.status, 0);
        assert.match(run.text, /The replay of "seed=3" passed\./);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("a plan naming a function narrows the replay to it", async () => {
    const root = project({
        "a.ts": "export function wanted(x: number) {\n    return x + 1;\n}\nexport function other(x: number) {\n    return x + 2;\n}\n",
    });
    try {
        const run = await flt([root, "--replay", "seed=3,fn=a.ts#wanted"]);
        assert.equal(run.status, 0);
        assert.match(run.text, /The replay of "seed=3,fn=a\.ts#wanted" passed\./);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("a plan naming a function the project does not have runs nothing and says so", async () => {
    const root = project({ "a.ts": "export function wanted(x: number) {\n    return x + 1;\n}\n" });
    try {
        const run = await flt([root, "--replay", "seed=3,fn=a.ts#missing"]);
        assert.equal(run.status, 0);
        assert.match(run.text, /passed\./);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("a replay of a run that failed fails the same way", async () => {
    const root = project({
        "a.ts": "export function two() {\n    return 2;\n}\n",
        "a.sim.ts":
            'import type { Checklist, Injector, Subject } from "faultline";\nimport { two } from "./a.ts";\nexport function wrong(s: Subject, i: Injector, c: Checklist) {\n    void s; void i; void c;\n    if (two() !== 3) {\n        throw new Error("CountedWrong");\n    }\n}\n',
    });
    try {
        const run = await flt([root, "--replay", "seed=1"]);
        assert.equal(run.status, 1);
        assert.match(run.text, /The replay of "seed=1" failed/);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("a test input factory is used where one was written", async () => {
    const run = await over({
        "a.ts":
            "export interface Loader {\n    load(): string;\n}\nexport function formatOf(loader: Loader) {\n    if (loader.load().startsWith('PNG')) {\n        return 'png';\n    }\n    return 'other';\n}\n",
        "a.sim.ts": 'import type { Loader } from "./a.ts";\nexport function pngLoader(): Loader {\n    return { load: () => "PNG and the rest" };\n}\n',
    });
    assert.equal(run.status, 0);
    assert.match(run.text, /Coverage: 3 of 3 paths, 100%\./);
});

test("the effects a run supplies are handed to the parameters that ask for them", async () => {
    const run = await over({
        "a.ts":
            'import type { Files } from "faultline";\nexport async function load(files: Files) {\n    try {\n        return (await files.read("/settings.json")).length;\n    }\n    catch {\n        return 0;\n    }\n}\n',
    });
    assert.equal(run.status, 0);
    assert.match(run.text, /Coverage: 2 of 2 paths, 100%\./);
});

test("a loop that never ends is stopped and named, and the rest of the run carries on", async () => {
    const run = await over(
        {
            "a.ts": "export function spin(go: boolean) {\n    while (go) {\n        continue;\n    }\n    return 1;\n}\nexport function safe(x: number) {\n    return x + 1;\n}\n",
        },
        ["--budget", "700"],
    );
    assert.equal(run.status, 1);
    assert.match(run.text, /ran past the budget without returning/);
    assert.match(run.text, /ran past the budget without returning/);
});

test("a run can be narrowed to one file", async () => {
    const run = await over(
        { "a.ts": "export function f() {\n    return 1;\n}\n", "b.ts": "export function g() {\n    return 2;\n}\n" },
        ["--file", "a.ts"],
    );
    assert.equal(run.status, 0);
    assert.match(run.text, /Read 1 source file, with 1 function to exercise\./);
});

test("narrowing to one file leaves another file's scenarios out of the run", async () => {
    const run = await over(
        {
            "a.ts": "export function f() {\n    return 1;\n}\n",
            "b.ts": "export function g() {\n    return 2;\n}\n",
            "b.sim.ts":
                'import type { Checklist, Injector, Subject } from "faultline";\nexport function alwaysWrong(s: Subject, i: Injector, c: Checklist) {\n    void s; void i; void c;\n    throw new Error("WouldStopTheRun");\n}\n',
        },
        ["--file", "a.ts"],
    );
    assert.equal(run.status, 0);
    assert.equal(run.text.includes("WouldStopTheRun"), false);
});

test("a file the run was told to measure and cannot find is said plainly", async () => {
    const run = await over({ "a.ts": "export const a = 1;\n" }, ["--file", "missing.ts"]);
    assert.equal(run.status, 1);
    assert.match(run.text, /No source file called missing\.ts was found/);
});

test("a run can be narrowed to one function", async () => {
    const run = await over(
        { "a.ts": "export function f() {\n    return 1;\n}\nexport function g() {\n    return 2;\n}\n" },
        ["--function", "g"],
    );
    assert.equal(run.status, 0);
    assert.match(run.text, /with 1 function to exercise\./);
});

test("the full list goes where the run was told to put it", async () => {
    const root = project({ "a.ts": "export function f() {\n    return 1;\n}\n" });
    const where = path.join(root, "..", `detail-${process.pid}.txt`);
    try {
        const run = await flt([root, "--seeds", "4", "--report", where]);
        assert.equal(run.status, 0);
        assert.match(fs.readFileSync(where, "utf8"), /Coverage: 1 of 1 paths, 100%\./);
    }
    finally {
        fs.rmSync(where, { force: true });
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("a file that will not parse stops the run and prints what the compiler said", async () => {
    const run = await over({ "a.ts": "export function f( {\n" });
    assert.equal(run.status, 1);
    assert.match(run.text, /The simulation would not compile\./);
    assert.match(run.text, /a\.ts:\d+:\d+/);
});

test("a directory with no source in it says so rather than passing", async () => {
    const run = await over({ "notes.md": "nothing to run here\n" });
    assert.equal(run.status, 1);
    assert.match(run.text, /no JavaScript or TypeScript file/);
});

test("a project whose manifest says its files are not modules is told so", async () => {
    const root = project({ "a.ts": "export const a = 1;\n" });
    fs.writeFileSync(path.join(root, "package.json"), '{ "name": "under-test", "type": "commonjs" }\n');
    try {
        const run = await flt([root]);
        assert.equal(run.status, 1);
        assert.match(run.text, /flt loads modules/);
    }
    finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("a file with no function in it is named and does not fail the run", async () => {
    const run = await over({ "a.ts": "export function f() {\n    return 1;\n}\n", "b.ts": "export const b = 1;\n" });
    assert.equal(run.status, 0);
    assert.match(run.text, /b\.ts declares no function, so there is no code in it to exercise\./);
});

test("a run reads the same twice, so the same source gives the same answer", async () => {
    const files = {
        "a.ts": "export function f(x: number) {\n    if (x > 3) {\n        return 1;\n    }\n    return 0;\n}\n",
    };
    const first = await over(files);
    const second = await over(files);
    assert.equal(first.status, second.status);
    assert.match(first.text, /Coverage: 3 of 3 paths, 100%\./);
    assert.match(second.text, /Coverage: 3 of 3 paths, 100%\./);
});
