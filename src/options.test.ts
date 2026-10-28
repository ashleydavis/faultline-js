//
// Tests the command line parser. Goal: every option of `flt` is read into its field, a bare `flt`
// is a run of the whole project, `clear` and `--replay` are commands of their own, and every
// mistake (an unknown option, a missing value, a bad number, an option given twice, `--replay`
// with more) is refused with a sentence saying what to type. Method: call `readOptions` and its
// helpers with argument lists written out in each test.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { defaultOptions, failedOptions, placeholderOf, readJobs, readOptions, setValue, type IOptions } from "./options.ts";

//
// The options `argumentList` reads as, failing the test when it is refused.
//
export function readOk(argumentList: string[]): IOptions {
    const read = readOptions(argumentList);
    assert(read.ok, `${argumentList.join(" ")} was refused.`);
    return read.value;
}

//
// The sentence `argumentList` is refused with, failing the test when it is read.
//
export function refusal(argumentList: string[]): string {
    const read = readOptions(argumentList);
    assert(!read.ok, `${argumentList.join(" ")} was read.`);
    return read.error.message;
}

describe("readOptions", () => {
    test("a bare flt runs the whole project with the cache", () => {
        assert.deepEqual(readOk([]), defaultOptions());
        assert.equal(readOk([]).command, "run");
    });

    test("every option of a run is read into its field, in any order", () => {
        const options = readOk(["--full-report", "--file", "src/a.ts", "--function", "f", "--report", "out/report.txt", "--jobs", "4", "--no-cache"]);
        assert.deepEqual(options, {
            command: "run",
            file: "src/a.ts",
            functionName: "f",
            token: undefined,
            report: "out/report.txt",
            jobs: 4,
            noCache: true,
            fullReport: true,
        });
    });

    test("clear on its own throws the kept results away", () => {
        assert.equal(readOk(["clear"]).command, "clear");
    });

    test("clear with anything else is not an option", () => {
        assert.equal(refusal(["clear", "--no-cache"]), "The flt command has no option clear. Its options are --file <path>, --function <name>, --replay \"<token>\", --report <path>, --jobs <n>, --no-cache and --full-report, and npx flt clear throws the kept results away.");
    });

    test("--replay with its token is the replay command", () => {
        const options = readOk(["--replay", "src/a.ts:f;seed=1"]);
        assert.equal(options.command, "replay");
        assert.equal(options.token, "src/a.ts:f;seed=1");
    });

    test("--replay with any other option is refused", () => {
        assert.equal(refusal(["--replay", "src/a.ts:f;seed=1", "--jobs", "2"]), "The option --replay takes one replay token and no other option, written as npx flt --replay \"<token>\".");
        assert.equal(refusal(["--no-cache", "--replay", "src/a.ts:f;seed=1"]), "The option --replay takes one replay token and no other option, written as npx flt --replay \"<token>\".");
    });

    test("an empty value is no value", () => {
        assert.equal(refusal(["--file", ""]), "The option --file needs a value after it, written as --file <path>.");
    });

    test("an option with no value after it says how to write it", () => {
        assert.equal(refusal(["--replay"]), "The option --replay needs a value after it, written as --replay \"<token>\".");
        assert.equal(refusal(["--file"]), "The option --file needs a value after it, written as --file <path>.");
        assert.equal(refusal(["--jobs"]), "The option --jobs needs a value after it, written as --jobs <n>.");
    });

    test("an unknown option, or a directory as the old tool took, is refused", () => {
        assert.match(refusal(["--seeds"]), /^The flt command has no option --seeds\. /);
        assert.match(refusal(["src"]), /^The flt command has no option src\. /);
    });

    test("an option given twice is refused", () => {
        assert.equal(refusal(["--no-cache", "--no-cache"]), "The option --no-cache is given twice, and it can be given once.");
        assert.equal(refusal(["--file", "a.ts", "--file", "b.ts"]), "The option --file is given twice, and it can be given once.");
    });

    test("--jobs that is not a whole number from 1 up is refused", () => {
        for (const jobs of ["0", "-1", "1.5", "two", "01"]) {
            assert.equal(refusal(["--jobs", jobs]), `The option --jobs takes a whole number from 1 up, and "${jobs}" is not one.`);
        }
    });
});

describe("setValue", () => {
    test("each option that takes a value sets its own field", () => {
        const options = defaultOptions();
        assert(setValue(options, {
            option: "--file",
            value: "a.ts",
        }).ok);
        assert(setValue(options, {
            option: "--function",
            value: "f",
        }).ok);
        assert(setValue(options, {
            option: "--replay",
            value: "t",
        }).ok);
        assert(setValue(options, {
            option: "--report",
            value: "r.txt",
        }).ok);
        assert(setValue(options, {
            option: "--jobs",
            value: "3",
        }).ok);
        assert.equal(options.file, "a.ts");
        assert.equal(options.functionName, "f");
        assert.equal(options.token, "t");
        assert.equal(options.report, "r.txt");
        assert.equal(options.jobs, 3);
    });

    test("an option that takes no value is a mistake in the caller", () => {
        assert.throws(() => setValue(defaultOptions(), {
            option: "--no-cache",
            value: "x",
        }), assert.AssertionError);
    });
});

describe("readJobs", () => {
    test("a whole number from 1 up is read and anything else is not", () => {
        assert.equal(readJobs("1"), 1);
        assert.equal(readJobs("16"), 16);
        assert.equal(readJobs("0"), undefined);
        assert.equal(readJobs(""), undefined);
        assert.equal(readJobs("99999999999999999999"), undefined);
    });
});

describe("placeholderOf", () => {
    test("each option's value is written the way the user guide writes it", () => {
        assert.equal(placeholderOf("--replay"), "\"<token>\"");
        assert.equal(placeholderOf("--function"), "<name>");
        assert.equal(placeholderOf("--jobs"), "<n>");
        assert.equal(placeholderOf("--file"), "<path>");
        assert.equal(placeholderOf("--report"), "<path>");
    });
});

describe("failedOptions", () => {
    test("a refusal carries its name and its sentence", () => {
        assert.deepEqual(failedOptions("bad-jobs", "The jobs are wrong."), {
            ok: false,
            error: {
                name: "bad-jobs",
                message: "The jobs are wrong.",
            },
        });
    });

    test("a message that is not a sentence is a mistake in Faultline", () => {
        assert.throws(() => failedOptions("bad-jobs", "jobs are wrong."), assert.AssertionError);
        assert.throws(() => failedOptions("bad-jobs", "The jobs are wrong"), assert.AssertionError);
    });
});
