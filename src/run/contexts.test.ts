//
// Checks the contexts a scenario and an expectation function get: an expectation that holds does
// nothing, one that does not is written down with the line of the sim file that made it and stops
// the function, `faults` says whether the run's planned failure was injected and `load` is the one
// it was given. The sim file's code is run in this process under a file name in a project, so its
// line is the one a stack trace names.
//

import assert from "node:assert/strict";
import vm from "node:vm";
import { describe, test } from "@jest/globals";
import { RunSubject } from "../world/subject.ts";
import { createExpectationContext, createScenarioContext, ExpectationStop, expectInto, type IExpectationRecord } from "./contexts.ts";

//
// Runs `code` as the sim file `/project/src/a.sim.ts`, with `context` in scope.
//
function runAsSim(code: string, context: object): void {
    vm.runInNewContext(code, { context }, { filename: "/project/src/a.sim.ts" });
}

describe("expect", () => {
    test("an expectation that holds does nothing and one that does not is written down and stops the function", () => {
        const records: IExpectationRecord[] = [];
        const context = createExpectationContext(records, "/project");
        runAsSim("context.expect(true, \"fine\");", context);
        assert.deepEqual(records, []);
        assert.throws(() => runAsSim("\ncontext.expect(1 > 2, \"one to be more than two\");\nthrow new Error(\"not reached\");", context), ExpectationStop);
        assert.deepEqual(records, [{
            expectation: "one to be more than two",
            location: "src/a.sim.ts:2",
        }]);
    });

    test("an expectation made outside the project has no line to name", () => {
        const records: IExpectationRecord[] = [];
        const expect = expectInto(records, "/project");
        assert.throws(() => expect(false, "elsewhere"), (error: unknown) => error instanceof ExpectationStop && error.message === "The expectation \"elsewhere\" did not hold.");
        assert.deepEqual(records, [{
            expectation: "elsewhere",
            location: "",
        }]);
    });
});

describe("createScenarioContext", () => {
    test("faults counts the planned failure once it is injected, and load is the one given", async () => {
        const subject = new RunSubject(1, {
            place: {
                effect: "clock",
                occurrence: 0,
            },
            failure: "time-stands-still",
        });
        const loaded = {
            value: 1,
        };
        const context = createScenarioContext(subject, [], "/project", async () => loaded);
        assert.equal(context.faults.injected, 0);
        subject.clock.now();
        assert.equal(context.faults.injected, 1);
        assert.equal(await context.load("src/a.ts"), loaded);
        const records: IExpectationRecord[] = [];
        assert.throws(() => createScenarioContext(subject, records, "/project", async () => loaded).expect(false, "no"), ExpectationStop);
        assert.equal(records.length, 1);
    });

    test("programs keeps what a scenario says a program answers, on the run, and refuses a nameless program or a code that is not whole", () => {
        const subject = new RunSubject(1, undefined);
        const context = createScenarioContext(subject, [], "/project", async () => ({}));
        context.programs.answer("ioreg", {
            stdout: "IOPlatformUUID\n",
            stderr: "",
            exitCode: 0,
        });
        assert.deepEqual(subject.programs.get("ioreg"), {
            stdout: "IOPlatformUUID\n",
            stderr: "",
            exitCode: 0,
        });
        assert.throws(() => context.programs.answer("", {
            stdout: "",
            stderr: "",
            exitCode: 0,
        }), /its name/);
        assert.throws(() => context.programs.answer("git", {
            stdout: "",
            stderr: "",
            exitCode: 0.5,
        }), /not a whole number/);
    });
});

describe("start", () => {
    test("start loads a file as load does and makes it the run's entry point, and an empty path is refused", async () => {
        const subject = new RunSubject(1, undefined);
        const loadedFiles: string[] = [];
        const context = createScenarioContext(subject, [], "/project", async (file: string) => {
            loadedFiles.push(file);
            return {
                loaded: file,
            };
        });
        assert.deepEqual(await context.start("src/index.ts"), {
            loaded: "src/index.ts",
        });
        assert.equal(subject.entryFile, "/project/src/index.ts");
        assert.deepEqual(loadedFiles, ["src/index.ts"]);
        assert.throws(() => context.start(""), /its path/);
    });
});
