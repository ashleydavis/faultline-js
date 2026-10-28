//
// Checks which outcomes of a call are failures: an engine error raised at a line of the project is
// a crash, while an error the code built itself, one raised in a package or in Node, and any other
// error are not. Also checks the keys that make one defect count once, and the sentences the report
// prints. Stacks are written out as Node writes them, so each case names the frame it is about.
//

import assert from "node:assert/strict";
import vm from "node:vm";
import { describe, test } from "@jest/globals";
import {
    crashNameOf,
    describeError,
    fileOfFrame,
    framesOf,
    isBuiltByCode,
    isError,
    isFailedOpen,
    isOwnFile,
    judgeExpectation,
    judgeFailedOpen,
    judgeHang,
    judgeUnbuiltValues,
    isUnbuiltValues,
    judgeThrown,
    judgeUncaught,
    locationOf,
    ownFirstFrame,
    ownFrame,
    sentence,
    subjectOf,
    type IJudgeContext,
} from "./judge.ts";

//
// A project with one file, `src/a.ts`, whose fifth line reads a property and whose eighth builds an
// error itself.
//
const context: IJudgeContext = {
    projectRoot: "/project",
    readSource: async (file: string) => {
        if (file === "/project/src/a.ts") {
            return ["", "", "", "export function boom(value) {", "    return value.x;", "}", "export function thrower() {", "    throw new TypeError(\"mine\");", "}"].join("\n");
        }
        return undefined;
    },
};

//
// An error of class `made` whose stack names `frames`, outermost last.
//
function errorAt(made: ErrorConstructor, message: string, frames: string[]): Error {
    const error = new made(message);
    error.stack = [`${error.name}: ${message}`, ...frames.map((frame) => `    at ${frame}`)].join("\n");
    return error;
}

describe("isError", () => {
    test("an error from this realm or another is an error, and anything else is not", () => {
        assert.equal(isError(new TypeError("x")), true);
        assert.equal(isError(vm.runInNewContext("new TypeError('x')")), true);
        assert.equal(isError({ name: "Error", message: "x" }), false);
        assert.equal(isError("x"), false);
    });

    test("an engine error from another realm is named like one from this realm", () => {
        assert.equal(crashNameOf(vm.runInNewContext("new RangeError('x')")), "RangeError");
    });
});

describe("crashNameOf", () => {
    test("names the engine's own errors and nothing else", () => {
        assert.equal(crashNameOf(new TypeError("x")), "TypeError");
        assert.equal(crashNameOf(new ReferenceError("x")), "ReferenceError");
        assert.equal(crashNameOf(new RangeError("x")), "RangeError");
        assert.equal(crashNameOf(new SyntaxError("x")), undefined);
        assert.equal(crashNameOf(new Error("x")), undefined);
        assert.equal(crashNameOf("TypeError"), undefined);
    });

    test("leaves out a class the code extended and an error renamed by the code", () => {
        class OwnError extends TypeError {}
        assert.equal(crashNameOf(new OwnError("x")), undefined);
        const renamed = new TypeError("x");
        renamed.name = "Other";
        assert.equal(crashNameOf(renamed), undefined);
    });
});

describe("frames", () => {
    test("reads every frame that names a file, with and without a function name", () => {
        const stack = [
            "TypeError: x",
            "    at String.repeat (<anonymous>)",
            "    at Module.boom (/project/src/a.ts:5:19)",
            "    at node:internal/process/task_queues:105:5",
            "    at file:///project/src/b.ts?flt=3:2:1",
        ].join("\n");
        assert.deepEqual(framesOf(stack), [
            { file: "/project/src/a.ts", line: 5, column: 19 },
            { file: "/project/src/b.ts", line: 2, column: 1 },
        ]);
    });

    test("a frame's location is a path, a file URL or no file at all", () => {
        assert.equal(fileOfFrame("/project/a.ts?flt=1"), "/project/a.ts");
        assert.equal(fileOfFrame("file:///project/a.ts?flt=1"), "/project/a.ts");
        assert.equal(fileOfFrame("node:internal/modules"), undefined);
    });

    test("a file is the project's own inside the project and outside every package", () => {
        assert.equal(isOwnFile("/project", "/project/src/a.ts"), true);
        assert.equal(isOwnFile("/project", "/project/node_modules/lib/a.js"), false);
        assert.equal(isOwnFile("/project", "/elsewhere/a.ts"), false);
    });

    test("the first frame counts only when it is the project's, and any frame of the project can be found", () => {
        const stack = "Error: x\n    at f (/project/node_modules/lib/a.js:1:1)\n    at g (/project/src/a.ts:5:3)";
        assert.equal(ownFirstFrame("/project", stack), undefined);
        assert.equal(ownFirstFrame("/project", "Error: x"), undefined);
        assert.deepEqual(ownFrame("/project", stack), { file: "/project/src/a.ts", line: 5, column: 3 });
        assert.equal(locationOf("/project", { file: "/project/src/a.ts", line: 5, column: 3 }), "src/a.ts:5");
    });

    test("code building an error is told from code the engine raised one at", () => {
        const text = "x\n  throw new RangeError(\"r\");\n  return value.x;\n  throw OwnError(\"o\");";
        assert.equal(isBuiltByCode(text, { file: "a", line: 2, column: 9 }), true);
        assert.equal(isBuiltByCode(text, { file: "a", line: 3, column: 15 }), false);
        assert.equal(isBuiltByCode(text, { file: "a", line: 4, column: 9 }), true);
        assert.equal(isBuiltByCode(text, { file: "a", line: 9, column: 1 }), false);
    });
});

describe("judgeThrown", () => {
    test("an engine error at a line of the project is a crash", async () => {
        const error = errorAt(TypeError, "Cannot read properties of undefined (reading 'x')", ["Module.boom (/project/src/a.ts:5:18)", "run (/tool/run/call.ts:1:1)"]);
        assert.deepEqual(await judgeThrown(context, error, "The call to boom", "t"), {
            kind: "crash",
            message: "The call to boom crashed with TypeError: Cannot read properties of undefined (reading 'x').",
            location: "src/a.ts:5",
            key: "crash|TypeError|src/a.ts:5:18",
            token: "t",
            stack: error.stack,
        });
    });

    test("an error the code built, one raised outside the project and any other error are not crashes", async () => {
        assert.equal(await judgeThrown(context, errorAt(TypeError, "mine", ["Module.thrower (/project/src/a.ts:8:11)"]), "s", "t"), undefined);
        assert.equal(await judgeThrown(context, errorAt(TypeError, "bad", ["f (/project/node_modules/lib/a.js:1:1)", "boom (/project/src/a.ts:5:18)"]), "s", "t"), undefined);
        assert.equal(await judgeThrown(context, errorAt(Error, "plain", ["boom (/project/src/a.ts:5:18)"]), "s", "t"), undefined);
        const noStack = new TypeError("none");
        noStack.stack = undefined;
        assert.equal(await judgeThrown(context, noStack, "s", "t"), undefined);
    });

    test("a crash in a file that cannot be read is still a crash", async () => {
        const judged = await judgeThrown(context, errorAt(RangeError, "Invalid array length.", ["f (/project/src/gone.ts:2:3)"]), "The call to f", "t");
        assert.equal(judged?.message, "The call to f crashed with RangeError: Invalid array length.");
    });
});

describe("judgeUnbuiltValues", () => {
    test("a call whose values could not be built is a crash keyed by its function and what building threw", () => {
        const thrown = new Error("no shelf");
        const failure = judgeUnbuiltValues("src/a.ts", "count", "The call to count", thrown, "t");
        assert.equal(failure.kind, "crash");
        assert.equal(failure.message, "The call to count was not made, because building its values failed with Error: no shelf.");
        assert.equal(failure.key, "values|src/a.ts|count|Error: no shelf");
        assert.equal(failure.stack, thrown.stack);
        assert.equal(failure.location, "");
        assert.equal(isUnbuiltValues(failure), true);
        assert.equal(isUnbuiltValues(judgeHang("src/a.ts", "count", "The call to count", "t")), false);
        assert.equal(judgeUnbuiltValues("src/a.ts", "count", "The call to count", new Error("ends in a full stop."), "t").message, "The call to count was not made, because building its values failed with Error: ends in a full stop.");
        assert.equal(judgeUnbuiltValues("src/a.ts", "count", "The call to count", "text", "t").stack, "");
        const stackless = new Error("no stack");
        stackless.stack = undefined;
        assert.equal(judgeUnbuiltValues("src/a.ts", "count", "The call to count", stackless, "t").stack, "");
        assert.throws(() => judgeUnbuiltValues("", "count", "The call to count", thrown, "t"), assert.AssertionError);
    });
});

describe("judgeFailedOpen", () => {
    test("a shard that failed to open is a crash keyed by its file and told apart from every other failure", () => {
        const failure = judgeFailedOpen("src/a.ts", "The call to (top level)", "with exit code 1", "t");
        assert.deepEqual(failure, {
            kind: "crash",
            message: "The call to (top level) was not made, because the child process opening src/a.ts ended with exit code 1.",
            location: "",
            key: "open|src/a.ts",
            token: "t",
            stack: "",
        });
        assert.equal(isFailedOpen(failure), true);
        assert.equal(isFailedOpen(judgeHang("src/a.ts", "f", "The call to f", "t")), false);
        assert.throws(() => judgeFailedOpen("src/a.ts", "The call to f", "", "t"), assert.AssertionError);
    });
});

describe("the other failures", () => {
    test("an uncaught error names the project's line when it has one", () => {
        const error = errorAt(Error, "late", ["Timeout.work (/project/src/a.ts:5:3)"]);
        assert.deepEqual(judgeUncaught(context, error, "The call to f", "t"), {
            kind: "uncaught",
            message: "The call to f left an error that no code caught: Error: late.",
            location: "src/a.ts:5",
            key: "uncaught|Error|src/a.ts:5",
            token: "t",
            stack: error.stack,
        });
        assert.deepEqual(judgeUncaught(context, "a string", "The call to f", "t"), {
            kind: "uncaught",
            message: "The call to f left an error that no code caught: a string.",
            location: "",
            key: "uncaught|string|",
            token: "t",
            stack: "",
        });
        const noStack = new Error("none");
        noStack.stack = undefined;
        assert.equal(judgeUncaught(context, noStack, "s", "t").location, "");
    });

    test("a hang and an expectation each carry their own key", () => {
        assert.deepEqual(judgeHang("src/a.ts", "f", "The call to f", "t"), {
            kind: "hang",
            message: "The call to f never returned.",
            location: "",
            key: "hang|src/a.ts|f",
            token: "t",
            stack: "",
        });
        assert.deepEqual(judgeExpectation("rows to match", "rowsAgree", "src/a.sim.ts:4", "t"), {
            kind: "expectation",
            message: "The expectation \"rows to match\" in rowsAgree did not hold.",
            location: "src/a.sim.ts:4",
            key: "expectation|src/a.sim.ts:4|rows to match",
            token: "t",
            stack: "",
        });
    });

    test("errors, sentences and subjects are written the way the report prints them", () => {
        assert.equal(describeError(new RangeError("r")), "RangeError: r");
        assert.equal(describeError(7), "7");
        assert.equal(sentence("done."), "done.");
        assert.equal(sentence("done"), "done.");
        assert.equal(subjectOf(true, "runPng"), "The scenario runPng");
        assert.equal(subjectOf(false, "parse"), "The call to parse");
    });
});
