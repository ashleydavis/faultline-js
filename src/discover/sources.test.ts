import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    alwaysSkipped,
    isDeclarationFile,
    isSimFile,
    isTestFile,
    simFileFor,
    sourceExtensions,
    toPosix,
    walkSources,
} from "./sources.ts";

// Writes a tree of empty files and hands back the directory they went into.
function tree(files: string[]): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "faultline-walk-"));
    for (const one of files) {
        const full = path.join(root, one);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, "");
    }
    return root;
}

test("a sim file is told by its name", () => {
    assert.equal(isSimFile("a.sim.ts"), true);
    assert.equal(isSimFile("a/b.sim.mts"), true);
    assert.equal(isSimFile("a.sim.js"), true);
    assert.equal(isSimFile("a.ts"), false);
    assert.equal(isSimFile("simple.ts"), false);
});

test("a test of its own is told by its name", () => {
    assert.equal(isTestFile("a.test.ts"), true);
    assert.equal(isTestFile("a.spec.js"), true);
    assert.equal(isTestFile("a.ts"), false);
    assert.equal(isTestFile("latest.ts"), false);
});

test("a file that only declares types is told by its name", () => {
    assert.equal(isDeclarationFile("a.d.ts"), true);
    assert.equal(isDeclarationFile("a.d.mts"), true);
    assert.equal(isDeclarationFile("a.ts"), false);
});

test("the sim file a source file would have carries its extension", () => {
    assert.equal(simFileFor("a/b.ts"), "a/b.sim.ts");
    assert.equal(simFileFor("a.mjs"), "a.sim.mjs");
});

test("a path is written the one way", () => {
    assert.equal(toPosix(path.join("a", "b", "c.ts")), "a/b/c.ts");
});

test("the walk finds every source file under the root", () => {
    const root = tree(["a.ts", "deep/b.ts", "deep/deeper/c.js"]);
    const walked = walkSources({ root, source: [], exclude: [] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["a.ts", "deep/b.ts", "deep/deeper/c.js"],
    );
    fs.rmSync(root, { recursive: true, force: true });
});

test("the walk sorts what it found, so a run reads the same twice", () => {
    const root = tree(["z.ts", "a.ts", "m.ts"]);
    const walked = walkSources({ root, source: [], exclude: [] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["a.ts", "m.ts", "z.ts"],
    );
    fs.rmSync(root, { recursive: true, force: true });
});

test("the walk never descends into somebody else's code or a build's own output", () => {
    const root = tree(["a.ts", ...alwaysSkipped.map((name) => `${name}/hidden.ts`)]);
    const walked = walkSources({ root, source: [], exclude: [] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["a.ts"],
    );
    fs.rmSync(root, { recursive: true, force: true });
});

test("a directory named in the exclusion is left out", () => {
    const root = tree(["a.ts", "bench/b.ts"]);
    const walked = walkSources({ root, source: [], exclude: ["bench"] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["a.ts"],
    );
    fs.rmSync(root, { recursive: true, force: true });
});

test("a file named in the exclusion is left out, with the reason", () => {
    const root = tree(["a.ts", "b.ts"]);
    const walked = walkSources({ root, source: [], exclude: ["b.ts"] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["a.ts"],
    );
    assert.equal(walked.skipped.some((one) => one.file === "b.ts" && one.because.includes("exclusion")), true);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a file named in the exclusion is matched by the path the report prints", () => {
    const root = tree(["src/a.ts", "src/b.ts"]);
    const walked = walkSources({ root, source: [], exclude: ["src/b.ts"] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["src/a.ts"],
    );
    fs.rmSync(root, { recursive: true, force: true });
});

test("only the directories named as source are walked, when any are", () => {
    const root = tree(["src/a.ts", "other/b.ts"]);
    const walked = walkSources({ root, source: ["src"], exclude: [] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["src/a.ts"],
    );
    fs.rmSync(root, { recursive: true, force: true });
});

test("a sim file is kept apart from the source it sits beside", () => {
    const root = tree(["a.ts", "a.sim.ts"]);
    const walked = walkSources({ root, source: [], exclude: [] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["a.ts"],
    );
    assert.equal(walked.sources[0]?.sim, path.join(root, "a.sim.ts"));
    assert.equal(walked.sims.size, 1);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a source file with no sim file beside it says so", () => {
    const root = tree(["a.ts"]);
    assert.equal(walkSources({ root, source: [], exclude: [] }).sources[0]?.sim, undefined);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a test and a declaration are left out, each with its reason", () => {
    const root = tree(["a.ts", "a.test.ts", "a.d.ts"]);
    const walked = walkSources({ root, source: [], exclude: [] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["a.ts"],
    );
    assert.deepEqual(walked.skipped.map((one) => one.file).sort(), ["a.d.ts", "a.test.ts"]);
    for (const one of walked.skipped) {
        assert.ok(one.because.length > 0);
    }
    fs.rmSync(root, { recursive: true, force: true });
});

test("a file with an extension the walk does not take is left where it is", () => {
    const root = tree(["a.ts", "notes.md", "data.json"]);
    const walked = walkSources({ root, source: [], exclude: [] });
    assert.deepEqual(
        walked.sources.map((one) => one.file),
        ["a.ts"],
    );
    fs.rmSync(root, { recursive: true, force: true });
});

test("every extension the walk takes is found", () => {
    const root = tree(sourceExtensions.map((extension, index) => `f${index}${extension}`));
    assert.equal(walkSources({ root, source: [], exclude: [] }).sources.length, sourceExtensions.length);
    fs.rmSync(root, { recursive: true, force: true });
});

test("a directory that cannot be read is named rather than stopping the walk", () => {
    const root = tree(["a.ts"]);
    const walked = walkSources({ root, source: ["missing"], exclude: [] });
    assert.equal(walked.sources.length, 0);
    assert.equal(walked.skipped.some((one) => one.because.includes("could not be read")), true);
    fs.rmSync(root, { recursive: true, force: true });
});
