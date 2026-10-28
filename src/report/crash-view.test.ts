//
// Checks the view of a failure: a crash in the project's code shows its place, the values, the
// injected failure, the line with a mark under the column, the stack from the command down and the
// hint; a failure with no frame in the project is its sentence alone; and each hint, injected
// failure sentence and ordinal is written as the report prints it.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import type { FailureKind, IFailure } from "../run/judge.ts";
import { calledWith, hintOf, injectedFailure, injectedLines, messageLines, ordinalSuffix, projectFrames, writeCrashView } from "./crash-view.ts";

//
// A failure of `kind` whose error's stack starts with `first` and has `frames`.
//
function failureOf(kind: FailureKind, first: string, frames: string[], token: string): IFailure {
    return {
        kind,
        message: "The call to parse crashed with TypeError: Cannot read properties of undefined (reading 'length').",
        location: frames.length === 0 ? "" : "src/a.ts:2",
        key: "k",
        token,
        stack: [first, ...frames.map((frame) => `    at ${frame}`)].join("\n"),
    };
}

describe("writeCrashView", () => {
    test("a crash in the project's code shows where, with what, the code, the stack and a hint", () => {
        const failure = failureOf("crash", "TypeError: Cannot read properties of undefined (reading 'length')", [
            "parse (/project/src/a.ts:2:17)",
            "use (/project/node_modules/lib/index.js:4:1)",
            "main (/project/src/main.ts:8:3)",
            "run (/tool/run/call.ts:9:3)",
            "node:internal/process/task_queues:105:5",
        ], "src/a.ts:parse;seed=1;values=b0;fail=read#1/input-or-output-error");
        const lines = writeCrashView({
            failure,
            arguments: ["''"],
            projectRoot: "/project",
            readSource: (file: string) => (file === "/project/src/a.ts" ? "export function parse(text: string) {\n    return text.x.length;\n}\n" : undefined),
            command: "npx flt",
        });
        assert.equal(lines[0], `-- CRASH src/a.ts:2:17 ${"-".repeat(100 - "-- CRASH src/a.ts:2:17 ".length)}`);
        assert.equal(lines[0]!.length, 100);
        assert.deepEqual(lines.slice(1), [
            failure.message,
            "",
            "  Called with:",
            "    argument 1: ''",
            "",
            "  Injected: the 2nd read call failed with \"Input or output error\".",
            "",
            "  2 |     return text.x.length;",
            "    |                 ^",
            "",
            "  Stack trace:",
            "    at src/a.ts:2:17",
            "    at /project/node_modules/lib/index.js:4:1",
            "    at src/main.ts:8:3",
            "    at npx flt",
            "",
            "  Hint: This line reads a property of a value that was undefined or null. Check for it first, or make sure no caller can pass it.",
        ]);
    });

    test("an error no code caught is headed as one, and a file that cannot be read shows no code", () => {
        const failure = failureOf("uncaught", "Error: late", ["Timeout.work (/project/src/b.ts:4:3)"], "src/b.ts:work;seed=1");
        const lines = writeCrashView({
            failure,
            arguments: [],
            projectRoot: "/project",
            readSource: () => undefined,
            command: "npx flt --replay \"src/b.ts:work;seed=1\"",
        });
        assert.equal(lines[0]!.startsWith("-- UNCAUGHT ERROR src/b.ts:4:3 --"), true);
        assert.deepEqual(lines.slice(1), [
            failure.message,
            "",
            "  Stack trace:",
            "    at src/b.ts:4:3",
            "    at npx flt --replay \"src/b.ts:work;seed=1\"",
            "",
            "  Hint: Work the call started threw and no code caught it. Await the promise the work returns, or catch the error where the work starts.",
        ]);
    });

    test("a line past the end of the file shows no code", () => {
        const lines = writeCrashView({
            failure: failureOf("crash", "TypeError: x is not a function", ["f (/project/src/a.ts:9:1)"], "src/a.ts:f;seed=1"),
            arguments: [],
            projectRoot: "/project",
            readSource: () => "one line",
            command: "npx flt",
        });
        assert.equal(lines.some((line) => line.includes(" | ")), false);
    });

    test("a failure with no frame in the project is its sentence, with its place when it has one", () => {
        const hang: IFailure = {
            kind: "hang",
            message: "The call to spin never returned.",
            location: "",
            key: "k",
            token: "src/a.ts:spin;seed=1;values=b0",
            stack: "",
        };
        assert.deepEqual(writeCrashView({
            failure: hang,
            arguments: ["0"],
            projectRoot: "/project",
            readSource: () => undefined,
            command: "npx flt",
        }), ["The call to spin never returned.", "", "  Called with:", "    argument 1: 0"]);
        const expectation: IFailure = {
            ...hang,
            kind: "expectation",
            message: "The expectation \"rows\" in agree did not hold.",
            location: "src/a.sim.ts:4",
        };
        assert.deepEqual(writeCrashView({
            failure: expectation,
            arguments: [],
            projectRoot: "/project",
            readSource: () => undefined,
            command: "npx flt",
        }), ["The expectation \"rows\" in agree did not hold. (src/a.sim.ts:4)"]);
    });
});

describe("messageLines", () => {
    test("a sentence on one line is one line, and one over several lines is a line each", () => {
        assert.deepEqual(messageLines("The call to f crashed."), ["The call to f crashed."]);
        assert.deepEqual(messageLines("The call to f ended, saying: Error: x\n    at a (/tool/a.js:1:1)."), ["The call to f ended, saying: Error: x", "    at a (/tool/a.js:1:1)."]);
    });

    test("an empty message is a programmer error", () => {
        assert.throws(() => messageLines(""), assert.AssertionError);
    });
});

describe("writeCrashView of a message over several lines", () => {
    test("every line of the view holds no line break, in the view with a frame and in the one without", () => {
        const withFrame = {
            ...failureOf("crash", "Error: x", ["parse (/project/src/a.ts:2:17)"], "src/a.ts:parse;seed=1;values=b0"),
            message: "The call to parse crashed with Error: first\nsecond.",
        };
        const withoutFrame = {
            ...failureOf("crash", "Error: x", [], "src/a.ts:parse;seed=1;values=b0"),
            message: "The call to parse ended the process running it with exit code 1, saying: Error: x\n    at a (/tool/a.js:1:1).",
        };
        for (const failure of [withFrame, withoutFrame]) {
            const lines = writeCrashView({
                failure,
                arguments: [],
                projectRoot: "/project",
                readSource: () => undefined,
                command: "npx flt",
            });
            assert.ok(lines.every((line) => !line.includes("\n")));
        }
        const shown = writeCrashView({
            failure: withoutFrame,
            arguments: [],
            projectRoot: "/project",
            readSource: () => undefined,
            command: "npx flt",
        });
        assert.deepEqual(shown, ["The call to parse ended the process running it with exit code 1, saying: Error: x", "    at a (/tool/a.js:1:1)."]);
    });
});

describe("projectFrames", () => {
    test("the frames below the last one in the project's own files are left out, Faultline's installed copy included", () => {
        const stack = "Error: x\n    at a (/project/src/a.ts:1:1)\n    at b (/tool/b.ts:2:2)\n    at c (/project/src/c.ts:3:3)\n    at d (/project/node_modules/faultline/dist/run/call.js:4:4)";
        assert.deepEqual(projectFrames("/project", stack).map((frame) => frame.file), ["/project/src/a.ts", "/tool/b.ts", "/project/src/c.ts"]);
        assert.deepEqual(projectFrames("/project", "Error: x\n    at b (/tool/b.ts:2:2)"), []);
    });
});

describe("calledWith and injectedLines", () => {
    test("each is left out when there is nothing to say", () => {
        assert.deepEqual(calledWith([]), []);
        assert.deepEqual(calledWith(["1", "'a'"]), ["", "  Called with:", "    argument 1: 1", "    argument 2: 'a'"]);
        assert.deepEqual(injectedLines("src/a.ts:f;seed=1"), []);
        assert.deepEqual(injectedLines("src/a.ts:f;seed=1;fail=file-open#0/file-not-found"), ["", "  Injected: the 1st file-open call failed with \"File not found\"."]);
    });
});

describe("injectedFailure", () => {
    test("a token's failure is written as what Faultline made happen, and a token that cannot be read injects none", () => {
        assert.equal(injectedFailure("src/a.ts:f;seed=1;fail=network#2/connection-refused"), "the 3rd network call failed with \"Connection refused\".");
        assert.equal(injectedFailure("src/a.ts:f;seed=x"), undefined);
    });
});

describe("ordinalSuffix", () => {
    test("st, nd and rd for one, two and three, and th for the rest and the teens", () => {
        assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((count) => ordinalSuffix(count)), ["st", "nd", "rd", "th", "th", "th", "th", "st", "nd", "rd", "st", "th"]);
        assert.throws(() => ordinalSuffix(0));
    });
});

describe("hintOf", () => {
    test("each kind of engine error has a hint of its own", () => {
        const hints = [
            "TypeError: Cannot read properties of null (reading 'a')",
            "TypeError: Cannot set properties of undefined (setting 'a')",
            "TypeError: run is not a function",
            "TypeError: items is not iterable",
            "TypeError: Cannot convert a BigInt value to a number",
            "ReferenceError: total is not defined",
            "RangeError: Maximum call stack size exceeded",
            "RangeError: Invalid array length",
            "RangeError: toFixed() digits argument must be between 0 and 100",
        ].map((first) => hintOf(failureOf("crash", first, [], "t")));
        assert.equal(new Set(hints).size, hints.length);
        assert.equal(hints.every((hint) => hint.endsWith(".")), true);
        assert.match(hints[0]!, /^This line reads a property/);
        assert.match(hints[1]!, /^This line sets a property/);
        assert.match(hints[2]!, /not a function/);
        assert.match(hints[3]!, /cannot be iterated/);
        assert.match(hints[4]!, /type does not allow/);
        assert.match(hints[5]!, /not declared/);
        assert.match(hints[6]!, /calls itself without end/);
        assert.match(hints[7]!, /array of a length/);
        assert.match(hints[8]!, /outside the range/);
    });

    test("a call whose values could not be built says to fix the value factory, whatever it threw", () => {
        const failure = {
            ...failureOf("crash", "Error: The shelf file is missing.", [], "t"),
            key: "values|src/a.ts|isEmpty|Error: The shelf file is missing.",
        };
        assert.match(hintOf(failure), /^Building a value for the call failed on this line/);
    });
});
