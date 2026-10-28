//
// Tests every line the report prints. Goal: each line reads as the report of the Zig Faultline
// does, with `npx flt` in place of `zig build flt`; the percentage is rounded down; the failure
// counts group by kind and count functions and scenarios apart; the exit code is 0 only at 100%
// with no failure. Method: build shard results and failures written out in each test and compare
// the lines made from them.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { callsPerSpecMost, type IShardResult } from "../run/explore.ts";
import type { FailureKind, IFailure } from "../run/judge.ts";
import type { IFunctionPlan, IPathRecord } from "../run/messages.ts";
import {
    cachedLines,
    coverageCounts,
    coverageLines,
    cutShortLines,
    exercisedLine,
    exitCodeOf,
    failureCountLines,
    firstFailureLines,
    fullReportLines,
    headerLine,
    kindWords,
    problemLines,
    progressLine,
    readCountLines,
    replayLine,
    reportPathLines,
    subjectKey,
    tookLine,
} from "./report.ts";

//
// A code path on line 1 of `at.file`, in the function `at.fn`, named `at.name`.
//
export function pathRecord(at: { file: string; fn: string; name: string }): IPathRecord {
    return {
        key: `${at.file}\t${at.name}`,
        file: at.file,
        line: 1,
        fn: at.fn,
        describe: at.name,
    };
}

//
// A function `label` that Faultline can call.
//
export function functionOf(label: string, line: number): IFunctionPlan {
    return {
        label,
        name: label,
        line,
        uncallable: undefined,
        unbuildable: undefined,
        choices: [],
        targets: [],
    };
}

//
// The result of a shard of `file` with `functions` and `paths` and no calls.
//
export function shardOf(file: string, functions: IFunctionPlan[], paths: IPathRecord[]): IShardResult {
    return {
        facts: {
            file,
            functions,
            scenarios: [],
            paths,
            notProvable: [],
            uncallable: [],
            simProblems: [],
            loadProblem: undefined,
        },
        tallies: [],
        exercised: [],
        failures: [],
        failedCalls: [],
    };
}

//
// A failure of `kind` found by a call of `at.name` in `at.file`.
//
export function failureOf(kind: FailureKind, at: { file: string; name: string }): IFailure {
    return {
        kind,
        message: `The call to ${at.name} failed.`,
        location: "",
        key: `${kind}|${at.file}|${at.name}`,
        token: `${at.file}:${at.name};seed=1`,
        stack: "",
    };
}

describe("headerLine", () => {
    test("names the project by its directory", () => {
        assert.equal(headerLine("/work/01-one-function"), "Fault testing the JavaScript and TypeScript source in 01-one-function.");
    });
});

describe("readCountLines", () => {
    test("counts the source files and their functions, the top level included, and leaves sim files out", () => {
        const shards = [shardOf("src/a.ts", [functionOf("(top level)", 1), functionOf("f", 2)], []), shardOf("src/a.sim.ts", [], [])];
        assert.deepEqual(readCountLines(shards), ["", "  Read 1 source file, 2 functions."]);
        assert.deepEqual(readCountLines([shardOf("src/a.ts", [functionOf("f", 1)], []), shardOf("src/b.ts", [], [])]), ["", "  Read 2 source files, 1 function."]);
    });
});

describe("problemLines", () => {
    test("each sim file problem and load problem is printed once", () => {
        const first = shardOf("src/a.ts", [], []);
        first.facts.simProblems.push("The sim file global.sim.ts has an error: x.");
        first.facts.loadProblem = "src/a.ts failed to load, so only its top level is called: SyntaxError: y.";
        const second = shardOf("src/b.ts", [], []);
        second.facts.simProblems.push("The sim file global.sim.ts has an error: x.");
        assert.deepEqual(problemLines([first, second]), [
            "  The sim file global.sim.ts has an error: x.",
            "  src/a.ts failed to load, so only its top level is called: SyntaxError: y.",
        ]);
        assert.deepEqual(problemLines([shardOf("src/c.ts", [], [])]), []);
    });

    test("a problem over several lines is printed a line at a time", () => {
        const shard = shardOf("src/a.ts", [], []);
        shard.facts.loadProblem = "src/a.ts failed to load, so only its top level is called: Error: first\n    at top (src/a.ts:1:1).";
        assert.deepEqual(problemLines([shard]), [
            "  src/a.ts failed to load, so only its top level is called: Error: first",
            "      at top (src/a.ts:1:1).",
        ]);
    });
});

describe("fullReportLines", () => {
    test("a block per source file with a line per function, marked by whether every code path was exercised", () => {
        const shard = shardOf("src/a.ts", [functionOf("done", 1), functionOf("missed", 5), functionOf("never", 9), functionOf("empty", 12)], [
            pathRecord({
            file: "src/a.ts",
            fn: "done",
            name: "done:entered",
        }),
            pathRecord({
            file: "src/a.ts",
            fn: "missed",
            name: "missed:entered",
        }),
            pathRecord({
            file: "src/a.ts",
            fn: "missed",
            name: "if:6:true",
        }),
            pathRecord({
            file: "src/a.ts",
            fn: "never",
            name: "never:entered",
        }),
        ]);
        shard.tallies.push({
            name: "done",
            line: 1,
            calls: 1,
            cutShort: false,
        }, {
            name: "missed",
            line: 5,
            calls: 12,
            cutShort: false,
        });
        const exercised = new Set(["src/a.ts\tdone:entered", "src/a.ts\tmissed:entered"]);
        assert.deepEqual(fullReportLines([shard, shardOf("src/a.sim.ts", [], [])], {
            exercised,
            cached: new Set(),
        }), [
            "",
            "Fault testing",
            "",
            "  src/a.ts",
            "    ok   done                             1/1 code paths, 1 call",
            "    MISS missed                           1/2 code paths, 12 calls",
            "    MISS never                            0/1 code paths, never called",
            "    ok   empty                            0/0 code paths",
        ]);
    });

    test("a file whose result came from the cache says so, and a long name keeps one space before its counts", () => {
        const name = "aFunctionWhoseNameIsLongerThanTheColumn";
        const shard = shardOf("src/a.ts", [functionOf(name, 1)], []);
        const lines = fullReportLines([shard], {
            exercised: new Set(),
            cached: new Set(["src/a.ts"]),
        });
        assert.equal(lines[3], "  src/a.ts (from the cache)");
        assert.equal(lines[4], `    ok   ${name} 0/0 code paths`);
    });
});

describe("replayLine and firstFailureLines", () => {
    test("a failure is its view and the command that repeats it, after a blank line", () => {
        const failure = failureOf("hang", {
            file: "src/a.ts",
            name: "f",
        });
        assert.equal(replayLine(failure.token), "Reproduce it with: npx flt --replay \"src/a.ts:f;seed=1\"");
        assert.deepEqual(firstFailureLines(failure, ["The call to f never returned."]), ["", "The call to f never returned.", replayLine(failure.token)]);
    });

    test("a token with a quote in it, or an empty view, is a mistake in Faultline", () => {
        assert.throws(() => replayLine("a\"b"), assert.AssertionError);
        assert.throws(() => firstFailureLines(failureOf("hang", {
            file: "src/a.ts",
            name: "f",
        }), []), assert.AssertionError);
    });
});

describe("cutShortLines", () => {
    test("a function cut short by the limit on calls is printed, and none gives no lines", () => {
        const shard = shardOf("src/a.ts", [], []);
        shard.tallies.push({
            name: "readAll",
            line: 4,
            calls: callsPerSpecMost,
            cutShort: true,
        });
        assert.deepEqual(cutShortLines([shard]), ["", `  Faultline stopped injecting failures into readAll at src/a.ts:4 after ${callsPerSpecMost} calls with one set of values, so some places it reached were not tried.`]);
        assert.deepEqual(cutShortLines([shardOf("src/a.ts", [], [])]), []);
    });
});

describe("failureCountLines", () => {
    test("no failure says so in one line", () => {
        assert.deepEqual(failureCountLines([]), ["", "  No call crashed, hung or found an expectation false."]);
    });

    test("failures are counted kind by kind in a fixed order, with the functions and scenarios they were in", () => {
        const failures = [
            failureOf("hang", {
            file: "src/a.ts",
            name: "f",
        }),
            failureOf("crash", {
            file: "src/a.ts",
            name: "f",
        }),
            {
                ...failureOf("crash", {
            file: "src/a.ts",
            name: "f",
        }),
                key: "another",
            },
            failureOf("crash", {
            file: "src/b.ts",
            name: "g",
        }),
            failureOf("crash", {
            file: "src/a.sim.ts",
            name: "s",
        }),
            failureOf("expectation", {
            file: "src/a.sim.ts",
            name: "s",
        }),
            failureOf("uncaught", {
            file: "src/a.ts",
            name: "f",
        }),
        ];
        assert.deepEqual(failureCountLines(failures), [
            "",
            "  4 calls crashed, in 2 functions and 1 scenario.",
            "  1 call left an error that no code caught, in 1 function.",
            "  1 call did not return in time, in 1 function.",
            "  1 expectation was false, in 1 scenario.",
        ]);
    });

    test("every kind of failure has its words", () => {
        assert.deepEqual(kindWords.map((words) => words.kind), ["crash", "uncaught", "hang", "expectation"]);
    });
});

describe("subjectKey", () => {
    test("a token names its file and function, and one that cannot be read is its own subject", () => {
        assert.equal(subjectKey("src/a.ts:f;seed=1;values=b0"), "src/a.ts\tf");
        assert.equal(subjectKey("nonsense"), "nonsense");
    });
});

describe("coverageCounts", () => {
    test("counts the exercised paths of every shard, and the functions and files with one", () => {
        const first = shardOf("src/a.ts", [], [pathRecord({
            file: "src/a.ts",
            fn: "f",
            name: "f:entered",
        }), pathRecord({
            file: "src/a.ts",
            fn: "f",
            name: "if:2:true",
        }), pathRecord({
            file: "src/a.ts",
            fn: "g",
            name: "g:entered",
        })]);
        const second = shardOf("src/b.ts", [], [pathRecord({
            file: "src/b.ts",
            fn: "h",
            name: "h:entered",
        })]);
        const counts = coverageCounts([first, second], new Set(["src/a.ts\tf:entered", "src/a.ts\tif:2:true", "src/a.ts\tg:entered"]));
        assert.deepEqual(counts, {
            ticked: 3,
            total: 4,
            functions: 2,
            files: 1,
        });
    });
});

describe("coverageLines and exercisedLine", () => {
    test("the coverage line rounds down and sits between blank lines", () => {
        const counts = {
            ticked: 2,
            total: 3,
            functions: 1,
            files: 1,
        };
        assert.deepEqual(coverageLines(counts), ["", "  Coverage: 2 of 3 code paths, 66%.", ""]);
        assert.equal(exercisedLine(counts), "  Exercised 2 code paths, 1 function, 1 file.");
    });

    test("nothing to fault test is 100%", () => {
        const counts = {
            ticked: 0,
            total: 0,
            functions: 0,
            files: 0,
        };
        assert.deepEqual(coverageLines(counts), ["", "  Coverage: 0 of 0 code paths, 100%.", ""]);
        assert.equal(exercisedLine(counts), "  Exercised 0 code paths, 0 functions, 0 files.");
    });
});

describe("cachedLines", () => {
    test("says how many source and sim files came from the cache, or nothing when none did", () => {
        assert.deepEqual(cachedLines(new Set()), []);
        assert.deepEqual(cachedLines(new Set(["src/a.ts", "src/b.ts", "global.sim.ts"])), ["  Cached 2 source files, 1 sim file."]);
        assert.deepEqual(cachedLines(new Set(["src/a.ts"])), ["  Cached 1 source file, 0 sim files."]);
    });
});

describe("tookLine, reportPathLines and progressLine", () => {
    test("each reads as the report reads it", () => {
        assert.equal(tookLine(26), "  Took 26ms.");
        assert.deepEqual(reportPathLines("node_modules/.cache/faultline/report.txt"), ["", "  Every failure and every thing to do is in node_modules/.cache/faultline/report.txt."]);
        assert.equal(progressLine({
            calls: 1,
            elapsedMs: 900,
            file: "src/a.ts",
            name: "f",
        }), "  Exercised 1 call in 0s, now in src/a.ts f.");
        assert.equal(progressLine({
            calls: 250,
            elapsedMs: 61000,
            file: "src/a.ts",
            name: "f",
        }), "  Exercised 250 calls in 1m 1s, now in src/a.ts f.");
    });
});

describe("exitCodeOf", () => {
    test("0 only at 100% with no failure", () => {
        const all = {
            ticked: 3,
            total: 3,
            functions: 1,
            files: 1,
        };
        assert.equal(exitCodeOf(all, [], []), 0);
        assert.equal(exitCodeOf({
            ...all,
            ticked: 2,
        }, [], []), 1);
        assert.equal(exitCodeOf(all, [failureOf("hang", {
            file: "src/a.ts",
            name: "f",
        })], []), 1);
    });

    test("1 at 100% when a file did not parse or load", () => {
        const all = {
            ticked: 0,
            total: 0,
            functions: 0,
            files: 0,
        };
        assert.equal(exitCodeOf(all, [], ["  src/a.ts does not parse, so it was not loaded: src/a.ts:1:1: ')' expected."]), 1);
    });
});
