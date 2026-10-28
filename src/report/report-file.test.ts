//
// Tests for the lines of the report file, by building each from a code path, failure, item or
// skipped file written out in the test, and the whole file's text from a shard result written out
// the same way.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import type { IFailure } from "../run/judge.ts";
import { checklistFileLines, pathItem } from "./checklist.ts";
import { failureFileLines, notProvableLine, pathLine, reportFileText, skippedLine } from "./report-file.ts";

describe("notProvableLine", () => {
    test("a path no range can prove ran is listed with its state, where it is, its name and its function", () => {
        const line = notProvableLine({
            name: "default:3:flag",
            file: "src/a.ts",
            line: 3,
            fn: "kinds",
            describe: "the default for `flag`",
        });
        assert.equal(line, "not provable src/a.ts:3 default:3:flag in kinds");
    });

    test("a path with no line or no name is a mistake in whoever found it", () => {
        const path = {
            name: "x",
            file: "src/a.ts",
            line: 0,
            fn: "f",
            describe: "x",
        };
        assert.throws(() => notProvableLine(path), assert.AssertionError);
        assert.throws(() => notProvableLine({
            ...path,
            line: 1,
            name: "",
        }), assert.AssertionError);
    });
});

//
// The true side of an `if` on line 2 of `f` in `src/a.ts`.
//
const record = {
    key: "src/a.ts\tif:2:true",
    file: "src/a.ts",
    line: 2,
    fn: "f",
    describe: "the true side of the if",
};

//
// A call of `f` that crashed.
//
const failure: IFailure = {
    kind: "crash",
    message: "The call to f crashed with TypeError: x.",
    location: "src/a.ts:2",
    key: "crash|TypeError|src/a.ts:2:5",
    token: "src/a.ts:f;seed=1;values=b0",
    stack: "",
};

describe("pathLine", () => {
    test("a provable path is listed as exercised or not, with where it is, its name and its function", () => {
        assert.equal(pathLine(record, true), "exercised src/a.ts:2 if:2:true in f");
        assert.equal(pathLine(record, false), "not exercised src/a.ts:2 if:2:true in f");
    });

    test("a key of another file is a mistake in whoever made the record", () => {
        assert.throws(() => pathLine({
            ...record,
            key: "src/b.ts\tif:2:true",
        }, true), assert.AssertionError);
    });
});

describe("failureFileLines", () => {
    test("a failure is its kind and sentence, then the command that repeats it", () => {
        assert.deepEqual(failureFileLines(failure), ["failed crash: The call to f crashed with TypeError: x.", "  replay with npx flt --replay \"src/a.ts:f;seed=1;values=b0\""]);
    });
});

describe("skippedLine", () => {
    test("a file the walk left out is listed with why", () => {
        assert.equal(skippedLine({
            file: "src/a.test.ts",
            because: "it is a test of its own",
        }), "skipped src/a.test.ts, because it is a test of its own.");
    });
});

describe("reportFileText", () => {
    test("every path, every failure, every thing to do and every skipped file, a line each", () => {
        const notProvable = {
            name: "default:3:flag",
            file: "src/a.ts",
            line: 3,
            fn: "f",
            describe: "the default for `flag`",
        };
        const item = pathItem(record);
        const text = reportFileText({
            shards: [{
                facts: {
                    file: "src/a.ts",
                    functions: [],
                    scenarios: [],
                    paths: [record],
                    notProvable: [notProvable],
                    uncallable: [],
                    simProblems: [],
                    loadProblem: undefined,
                },
                tallies: [],
                exercised: [],
                failures: [],
                failedCalls: [],
            }],
            exercised: new Set(),
            failures: [failure],
            items: [item],
            skipped: [{
                file: "node_modules",
                because: "it holds installed packages, not the project's own code",
            }],
        });
        assert.equal(text, [
            pathLine(record, false),
            notProvableLine(notProvable),
            ...failureFileLines(failure),
            ...checklistFileLines([item]),
            "skipped node_modules, because it holds installed packages, not the project's own code.",
        ].map((line) => `${line}\n`).join(""));
    });
});
