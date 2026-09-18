import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PathSite } from "../discover/paths.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import type { DriveResult } from "../drive/host.ts";
import type { RunModel } from "../model.ts";
import { report, writeDetail, type ReportInput } from "./report.ts";
import type { FunctionTally, RunTally } from "./tally.ts";

// One path, written as short as a test needs it.
function site(name: string, fn = "f"): PathSite {
    return { name, describe: `the ${name}`, file: "a.ts", line: 2, fn, at: { line: 2, column: 0 } };
}

// One function the report would give a line to.
function held(label = "f"): FunctionInfo {
    return { label, file: "a.ts", line: 1, reach: { how: "export", name: label }, parameters: [], async: false };
}

// A tally built from how many of one function's paths ran.
function counted(ticked: number, total: number, over: Partial<FunctionTally> = {}): RunTally {
    const paths = Array.from({ length: total }, (_, index) => ({ site: site(`p${index}`), ticked: index < ticked }));
    const one: FunctionTally = { held: held(), paths, ticked, calls: 8, hung: false, ...over };
    return {
        files: [{ file: "a.ts", functions: [one], complete: ticked === total }],
        total,
        ticked,
        empty: [],
    };
}

// Everything a report is written from, with what a test wants changed.
function input(tally: RunTally, over: Partial<ReportInput> = {}): ReportInput {
    const model: RunModel = {
        root: "/tmp",
        work: "/tmp/w",
        files: [],
        factories: [],
        scenarios: [],
        invariants: [],
        simModules: {},
        unseen: [],
        seeds: [1, 2, 3, 4],
        callBudget: 5000,
    };
    const result: DriveResult = {
        scripts: new Map(),
        calls: new Map(),
        stepped: 0,
        hung: 0,
        died: 0,
        hungFunctions: new Set(),
        cannotBuild: new Map(),
        done: 0,
        rounds: 1,
    };
    return {
        model,
        result,
        tally,
        found: 1,
        skipped: [],
        reportFile: "/tmp/w/coverage-report.txt",
        took: 0,
        all: false,
        ...over,
    };
}

// What the report printed, as one piece of text.
function printed(one: ReportInput): string {
    return report(one).lines.join("\n");
}

test("a run with every path reached passes and exits zero", () => {
    const verdict = report(input(counted(2, 2)));
    assert.equal(verdict.status, 0);
    assert.match(verdict.lines.join("\n"), /Coverage: 2 of 2 paths, 100%\./);
    assert.match(verdict.lines.join("\n"), /Passed: every code path ran\./);
});

test("a run one path short fails and exits one", () => {
    const verdict = report(input(counted(1, 2)));
    assert.equal(verdict.status, 1);
    assert.match(verdict.lines.join("\n"), /Coverage: 1 of 2 paths, 50%\./);
    assert.match(verdict.lines.join("\n"), /Failed: 1 code path of 2 was never reached\./);
});

test("a function with a path left gets a line saying which, with its counts", () => {
    assert.match(printed(input(counted(1, 3))), /MISS f\s+1\/3 paths, 8 calls/);
});

test("a function that covered every path is counted rather than listed", () => {
    const text = printed(input(counted(2, 2)));
    assert.equal(text.includes("ok   f"), false);
    assert.match(text, /1 function covered every path, and is not listed above\./);
});

test("every function gets a line when the run was asked for all of them", () => {
    assert.match(printed(input(counted(2, 2), { all: true })), /ok\s+f\s+2\/2 paths/);
});

test("a function nothing called says so instead of a call count", () => {
    assert.match(printed(input(counted(0, 2, { calls: 0 }))), /never called/);
});

test("the summary says what was found and how much of it ran", () => {
    assert.match(
        printed(input(counted(1, 2), { found: 3 })),
        /Found 3 source files, tested 1, exercised 1 function and executed 1 of 2 paths\./,
    );
});

test("a file with no function in it is named in the summary", () => {
    const tally = counted(1, 2);
    tally.empty.push("empty.ts");
    const text = printed(input(tally));
    assert.match(text, /with 1 having no function in it/);
    assert.match(text, /empty\.ts declares no function, so there is no code in it to exercise\./);
});

test("a file the walk left out is named with the reason", () => {
    const text = printed(input(counted(2, 2), { skipped: [{ file: "a.test.ts", because: "it is a test of its own" }] }));
    assert.match(text, /a\.test\.ts was left out because it is a test of its own\./);
});

test("the run says what was broken underneath the code while it ran", () => {
    assert.match(printed(input(counted(2, 2))), /3 against a network that refuses connections/);
});

test("a run sweeping one seed says nothing was broken under it", () => {
    const one = input(counted(2, 2));
    one.model.seeds = [1];
    assert.match(printed(one), /Every call ran against effects that answered/);
});

test("calls stepped over are said, and left out when there were none", () => {
    assert.equal(printed(input(counted(2, 2))).includes("Stepped over"), false);
    const stepped = input(counted(2, 2));
    stepped.result.stepped = 5;
    assert.match(printed(stepped), /Stepped over 5 calls for throwing on an input/);
});

test("units stopped for running past the budget are said as well", () => {
    const one = input(counted(2, 2));
    one.result.stepped = 5;
    one.result.hung = 2;
    assert.match(printed(one), /stopped 2 units that ran past the budget/);
});

test("a unit that ended the run itself is said, and the run carried on past it", () => {
    const one = input(counted(2, 2));
    one.result.stepped = 1;
    one.result.died = 3;
    assert.match(printed(one), /started again after 3 units that ended the run themselves/);
});

test("a run that drove more than one round says how many", () => {
    const one = input(counted(1, 2));
    one.result.rounds = 3;
    assert.match(printed(one), /Drove 3 rounds/);
});

test("a run that drove one round says nothing about rounds", () => {
    assert.equal(printed(input(counted(2, 2))).includes("Drove"), false);
});

test("the paths no call reached are listed above the things to do", () => {
    const text = printed(input(counted(1, 2)));
    assert.match(text, /FAIL 1 code path that no call reached:/);
    assert.match(text, /One thing to do:/);
    assert.ok(text.indexOf("FAIL") < text.indexOf("One thing to do"));
});

test("the file the full list went to is named on one line", () => {
    assert.match(printed(input(counted(2, 2))), /Full detail is in \/tmp\/w\/coverage-report\.txt\./);
});

test("the full list carries every path, ticked or not, with its file and its line", () => {
    const where = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "faultline-detail-")), "out.txt");
    writeDetail(where, counted(1, 2));
    const text = fs.readFileSync(where, "utf8");
    assert.match(text, /\[x\] a\.ts:2 "p0" the p0/);
    assert.match(text, /\[ \] a\.ts:2 "p1" the p1/);
    assert.match(text, /Coverage: 1 of 2 paths, 50%\./);
    fs.rmSync(path.dirname(where), { recursive: true, force: true });
});

test("a run with no path at all reads as a hundred and passes", () => {
    const verdict = report(input({ files: [], total: 0, ticked: 0, empty: [] }));
    assert.equal(verdict.status, 0);
    assert.match(verdict.lines.join("\n"), /Coverage: 0 of 0 paths, 100%\./);
});

test("a run where every path ran against a stand-in stays red", () => {
    const one = counted(1, 1);
    one.files[0]!.functions[0]!.needs = { parameter: "tag", typeText: "symbol" };
    const verdict = report(input(one));
    assert.equal(verdict.status, 1);
    assert.match(verdict.lines.join("\n"), /Coverage: 1 of 1 path, 100%\./);
    assert.match(verdict.lines.join("\n"), /Failed: every code path ran, and the thing above has still to be written\./);
});
