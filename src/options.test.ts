//
// Tests the command line parser. Goal: every option of `flt` is read into its field, a bare `flt`
// is a run of the whole project, `clear` and `--replay` are commands of their own, and every
// mistake (an unknown option, a missing value, a bad number, an option given twice, `--replay`
// with more) is refused with a sentence saying what to type. Method: call `readOptions` and its
// helpers with argument lists written out in each test.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { defaultOptions, failedOptions, placeholderOf, readWorkers, readOptions, setValue, splitArguments, type IOptions } from "./options.ts";

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
        const options = readOk(["--full-report", "--file", "src/a.ts", "--function", "f", "--report", "out/report.txt", "--workers", "4", "--no-cache"]);
        assert.deepEqual(options, {
            command: "run",
            file: "src/a.ts",
            functionName: "f",
            token: undefined,
            report: "out/report.txt",
            workers: 4,
            noCache: true,
            fullReport: true,
        });
    });

    test("clear on its own throws the kept results away", () => {
        assert.equal(readOk(["clear"]).command, "clear");
    });

    test("clear with anything else is not an option", () => {
        assert.equal(refusal(["clear", "--no-cache"]), "The flt command has no option clear. Its options are --file <path>, --function <name>, --replay \"<token>\", --report <path>, --workers <n>, --no-cache and --full-report, and npx flt clear throws the kept results away.");
    });

    test("--replay with its token is the replay command", () => {
        const options = readOk(["--replay", "src/a.ts:f;seed=1"]);
        assert.equal(options.command, "replay");
        assert.equal(options.token, "src/a.ts:f;seed=1");
    });

    test("--replay with any other option is refused", () => {
        assert.equal(refusal(["--replay", "src/a.ts:f;seed=1", "--workers", "2"]), "The option --replay takes one replay token and no other option, written as npx flt --replay \"<token>\".");
        assert.equal(refusal(["--no-cache", "--replay", "src/a.ts:f;seed=1"]), "The option --replay takes one replay token and no other option, written as npx flt --replay \"<token>\".");
    });

    test("an empty value is no value", () => {
        assert.equal(refusal(["--file", ""]), "The option --file needs a value after it, written as --file <path>.");
    });

    test("an option with no value after it says how to write it", () => {
        assert.equal(refusal(["--replay"]), "The option --replay needs a value after it, written as --replay \"<token>\".");
        assert.equal(refusal(["--file"]), "The option --file needs a value after it, written as --file <path>.");
        assert.equal(refusal(["--workers"]), "The option --workers needs a value after it, written as --workers <n>.");
    });

    test("an unknown option, or a directory as the old tool took, is refused", () => {
        assert.match(refusal(["--seeds"]), /^The flt command has no option --seeds\. /);
        assert.match(refusal(["src"]), /^The flt command has no option src\. /);
    });

    test("an option given twice is refused", () => {
        assert.equal(refusal(["--no-cache", "--no-cache"]), "The option --no-cache is given twice, and it can be given once.");
        assert.equal(refusal(["--file", "a.ts", "--file", "b.ts"]), "The option --file is given twice, and it can be given once.");
    });

    test("--workers that is not a whole number from 1 up is refused", () => {
        for (const workers of ["0", "-1", "1.5", "two", "01"]) {
            assert.equal(refusal(["--workers", workers]), `The option --workers takes a whole number from 1 up, and "${workers}" is not one.`);
        }
    });

    test("an option's value is read the same after a space and after an equals sign", () => {
        assert.deepEqual(readOk(["--workers=10"]), readOk(["--workers", "10"]));
        assert.equal(readOk(["--workers=10"]).workers, 10);
        assert.deepEqual(readOk(["--file=src/a.ts", "--function", "f"]), readOk(["--file", "src/a.ts", "--function=f"]));
        assert.equal(readOk(["--replay=src/a.ts:f;seed=1"]).token, "src/a.ts:f;seed=1");
    });

    test("a -- in front of the options, as npm and Bun pass them on, is left out", () => {
        assert.deepEqual(readOk(["--", "--workers=10"]), readOk(["--workers", "10"]));
        assert.deepEqual(readOk(["--", "--workers", "10"]), readOk(["--workers", "10"]));
        assert.equal(readOk(["--", "clear"]).command, "clear");
    });

    test("an option written with an equals sign is refused as the spaced one is", () => {
        assert.equal(refusal(["--workers="]), "The option --workers needs a value after it, written as --workers <n>.");
        assert.equal(refusal(["--workers=two"]), "The option --workers takes a whole number from 1 up, and \"two\" is not one.");
        assert.equal(refusal(["--workers=2", "--workers", "3"]), "The option --workers is given twice, and it can be given once.");
        assert.match(refusal(["--made-up=1"]), /^The flt command has no option --made-up\./);
        assert.match(refusal(["--", "--"]), /^The flt command has no option --\./);
    });
});

describe("splitArguments", () => {
    test("an option with an equals sign becomes the option and its value, split at the first equals sign", () => {
        assert.deepEqual(splitArguments(["--workers=10"]), ["--workers", "10"]);
        assert.deepEqual(splitArguments(["--replay=a.ts:f;seed=1"]), ["--replay", "a.ts:f;seed=1"]);
        assert.deepEqual(splitArguments(["--workers="]), ["--workers", ""]);
    });

    test("a leading -- is dropped and every other word is kept as it is", () => {
        assert.deepEqual(splitArguments(["--", "--workers", "10"]), ["--workers", "10"]);
        assert.deepEqual(splitArguments(["--workers", "--"]), ["--workers", "--"]);
        assert.deepEqual(splitArguments(["src/a=b.ts", "-x=1", "--=1"]), ["src/a=b.ts", "-x=1", "--=1"]);
        assert.deepEqual(splitArguments([]), []);
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
            option: "--workers",
            value: "3",
        }).ok);
        assert.equal(options.file, "a.ts");
        assert.equal(options.functionName, "f");
        assert.equal(options.token, "t");
        assert.equal(options.report, "r.txt");
        assert.equal(options.workers, 3);
    });

    test("an option that takes no value is a mistake in the caller", () => {
        assert.throws(() => setValue(defaultOptions(), {
            option: "--no-cache",
            value: "x",
        }), assert.AssertionError);
    });
});

describe("readWorkers", () => {
    test("a whole number from 1 up is read and anything else is not", () => {
        assert.equal(readWorkers("1"), 1);
        assert.equal(readWorkers("16"), 16);
        assert.equal(readWorkers("0"), undefined);
        assert.equal(readWorkers(""), undefined);
        assert.equal(readWorkers("99999999999999999999"), undefined);
    });
});

describe("placeholderOf", () => {
    test("each option's value is written the way the user guide writes it", () => {
        assert.equal(placeholderOf("--replay"), "\"<token>\"");
        assert.equal(placeholderOf("--function"), "<name>");
        assert.equal(placeholderOf("--workers"), "<n>");
        assert.equal(placeholderOf("--file"), "<path>");
        assert.equal(placeholderOf("--report"), "<path>");
    });
});

describe("failedOptions", () => {
    test("a refusal carries its name and its sentence", () => {
        assert.deepEqual(failedOptions("bad-workers", "The workers are wrong."), {
            ok: false,
            error: {
                name: "bad-workers",
                message: "The workers are wrong.",
            },
        });
    });

    test("a message that is not a sentence is a mistake in Faultline", () => {
        assert.throws(() => failedOptions("bad-workers", "workers are wrong."), assert.AssertionError);
        assert.throws(() => failedOptions("bad-workers", "The workers are wrong"), assert.AssertionError);
    });
});
