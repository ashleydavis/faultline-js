import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { defaultBudget, defaultSeeds, readOptions, seedsFor, usage } from "./options.ts";

test("no argument at all asks for the usage", () => {
    assert.equal(readOptions([], "/tmp").help, true);
});

test("the usage says what the tool does and what it exits with", () => {
    assert.match(usage, /every code path/);
    assert.match(usage, /exits 1/);
});

test("the directory defaults to where the tool was run", () => {
    assert.equal(readOptions(["--all"], "/tmp/here").root, "/tmp/here");
});

test("a directory given is resolved against where the tool was run", () => {
    assert.equal(readOptions(["sub"], "/tmp/here").root, path.resolve("/tmp/here", "sub"));
});

test("two directories are refused, because a run measures one", () => {
    assert.throws(() => readOptions(["a", "b"], "/tmp"), /given twice/);
});

test("the defaults are what a run uses when it is told none", () => {
    const options = readOptions(["."], "/tmp");
    assert.equal(options.seeds, defaultSeeds);
    assert.equal(options.budget, defaultBudget);
    assert.equal(options.all, false);
    assert.deepEqual(options.source, []);
    assert.deepEqual(options.exclude, []);
});

test("a directory to walk and a name to leave out can each be given more than once", () => {
    const options = readOptions(["--source", "src", "--source", "lib", "--exclude", "bench", "--exclude", "fixtures"], "/tmp");
    assert.deepEqual(options.source, ["src", "lib"]);
    assert.deepEqual(options.exclude, ["bench", "fixtures"]);
});

test("a value written after an equals reads the same as one written after a space", () => {
    assert.equal(readOptions(["--seeds=4"], "/tmp").seeds, 4);
    assert.equal(readOptions(["--seeds", "4"], "/tmp").seeds, 4);
});

test("a run can be narrowed to one file and one function", () => {
    const options = readOptions(["--file", "a.ts", "--function", "greet"], "/tmp");
    assert.equal(options.file, "a.ts");
    assert.equal(options.fn, "greet");
});

test("the report is written where it was told, resolved against where the tool was run", () => {
    assert.equal(readOptions(["--report", "out.txt"], "/tmp/here").report, "/tmp/here/out.txt");
});

test("a plan given is read", () => {
    assert.deepEqual(readOptions(["--replay", "seed=9"], "/tmp").replay, { seed: 9, fn: undefined });
});

test("help and version each stop the run", () => {
    assert.equal(readOptions(["--help"], "/tmp").help, true);
    assert.equal(readOptions(["--version"], "/tmp").version, true);
});

test("a seed count that is not a whole number of one or more is refused", () => {
    assert.throws(() => readOptions(["--seeds", "0"], "/tmp"), /one or more/);
    assert.throws(() => readOptions(["--seeds", "x"], "/tmp"), /one or more/);
});

test("a budget that is not a whole number of milliseconds is refused", () => {
    assert.throws(() => readOptions(["--budget", "0"], "/tmp"), /milliseconds/);
});

test("an option with no value after it is refused", () => {
    assert.throws(() => readOptions(["--file"], "/tmp"), /takes a value/);
});

test("an option the tool has no name for is refused rather than passed over", () => {
    assert.throws(() => readOptions(["--made-up"], "/tmp"), /no option called/);
});

test("the seeds swept are the whole numbers from one", () => {
    assert.deepEqual(seedsFor(readOptions(["--seeds", "3"], "/tmp")), [1, 2, 3]);
});

test("a replay sweeps the one seed its plan names", () => {
    assert.deepEqual(seedsFor(readOptions(["--replay", "seed=9"], "/tmp")), [9]);
});
