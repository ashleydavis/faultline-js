//
// Reads what was typed after `flt` into the options of one command, or says in a sentence what is
// wrong with it.
//
// `include` and `exclude` live in the project's `faultline.config.yaml`, because they describe the
// project.
// Everything here describes one run, so it is typed on the command line.
//

import assert from "node:assert/strict";

//
// Which command was asked for: a fault testing run, the replay of one token, or throwing away the
// kept results.
//
export type Command = "run" | "replay" | "clear";

//
// What one command is told.
//
export interface IOptions {
    //
    // Which command it is.
    //
    command: Command;

    //
    // The one file to fault test, relative to the project root, or undefined for every file.
    //
    file: string | undefined;

    //
    // The one function or scenario to fault test, or undefined for every one.
    //
    functionName: string | undefined;

    //
    // The replay token, for a replay.
    //
    token: string | undefined;

    //
    // Where to write the report file, relative to the project root, or undefined for the cache
    // directory.
    //
    report: string | undefined;

    //
    // How many workers run at once, or undefined for one per processor core.
    //
    workers: number | undefined;

    //
    // Whether to execute every file and keep no results.
    //
    noCache: boolean;

    //
    // Whether to print a block per file with a line per function.
    //
    fullReport: boolean;
}

//
// Why the command line could not be read.
//
export interface IOptionsError {
    //
    // Which error it is.
    //
    name: "unknown-option" | "missing-value" | "bad-workers" | "repeated-option" | "replay-with-more";

    //
    // A sentence for the person running Faultline, saying what is wrong and what to type.
    //
    message: string;
}

//
// A command line that was read.
//
export interface IOptionsRead {
    //
    // It was read.
    //
    ok: true;

    //
    // What it asks for.
    //
    value: IOptions;
}

//
// A command line that could not be read.
//
export interface IOptionsFailed {
    //
    // It was not read.
    //
    ok: false;

    //
    // Why.
    //
    error: IOptionsError;
}

//
// What reading the command line gives back.
//
export type OptionsResult = IOptionsRead | IOptionsFailed;

//
// The options of a bare `npx flt`: a run of every file of the project, with the results cache. A
// function rather than a constant, because the parser fills in the object it is given and each
// command line needs one of its own.
//
export function defaultOptions(): IOptions {
    return {
        command: "run",
        file: undefined,
        functionName: undefined,
        token: undefined,
        report: undefined,
        workers: undefined,
        noCache: false,
        fullReport: false,
    };
}

//
// The options that take a value after them.
//
const valueOptions = ["--file", "--function", "--replay", "--report", "--workers"];

//
// Reads the arguments typed after `flt`. `clear` stands alone. `--replay` takes its token and no
// other option, because a replay makes one call and nothing else changes it. Every other option may
// be given once, in any order.
//
export function readOptions(typed: string[]): OptionsResult {
    assert(Array.isArray(typed));
    const argumentList = splitArguments(typed);
    const options = defaultOptions();
    if (argumentList[0] === "clear") {
        if (argumentList.length === 1) {
            options.command = "clear";
            return {
                ok: true,
                value: options,
            };
        }
    }
    const seen = new Set<string>();
    //
    // Each turn takes one argument, or an option and its value, so the loop ends.
    //
    for (let index = 0; index < argumentList.length; index += 1) {
        const option = argumentList[index];
        assert(option !== undefined);
        if (seen.has(option)) {
            return failedOptions("repeated-option", `The option ${option} is given twice, and it can be given once.`);
        }
        seen.add(option);
        if (option === "--no-cache") {
            options.noCache = true;
            continue;
        }
        if (option === "--full-report") {
            options.fullReport = true;
            continue;
        }
        if (!valueOptions.includes(option)) {
            return failedOptions("unknown-option", `The flt command has no option ${option}. Its options are --file <path>, --function <name>, --replay "<token>", --report <path>, --workers <n>, --no-cache and --full-report, and npx flt clear throws the kept results away.`);
        }
        const value = argumentList[index + 1];
        if (!value) {
            return failedOptions("missing-value", `The option ${option} needs a value after it, written as ${option} ${placeholderOf(option)}.`);
        }
        index += 1;
        const set = setValue(options, {
            option,
            value,
        });
        if (!set.ok) {
            return set;
        }
    }
    if (options.token) {
        if (seen.size > 1) {
            return failedOptions("replay-with-more", "The option --replay takes one replay token and no other option, written as npx flt --replay \"<token>\".");
        }
        options.command = "replay";
    }
    assert(options.workers === undefined || options.workers > 0);
    return {
        ok: true,
        value: options,
    };
}

//
// The arguments as `readOptions` reads them: a `--` in front of them dropped, because `npx flt --
// <options>` is how npm and Bun pass options on, and an option written `--workers=10` split into
// `--workers` and `10`, the way most commands take it. A value is split off at its first `=` only,
// so a replay token, which holds `=` itself, keeps the rest.
//
export function splitArguments(typed: string[]): string[] {
    const words = typed[0] === "--" ? typed.slice(1) : typed;
    const split: string[] = [];
    for (const word of words) {
        const equals = word.indexOf("=");
        if (word.startsWith("--") && equals > 2) {
            split.push(word.slice(0, equals), word.slice(equals + 1));
        }
        else {
            split.push(word);
        }
    }
    assert(split.length >= words.length);
    return split;
}

//
// Sets the option `given.option` takes from `given.value`, or says why the value cannot be used.
//
export function setValue(options: IOptions, given: { option: string; value: string }): OptionsResult {
    const option = given.option;
    const value = given.value;
    assert(valueOptions.includes(option));
    assert(value.length > 0);
    if (option === "--file") {
        options.file = value;
    }
    else {
        if (option === "--function") {
            options.functionName = value;
        }
        else {
            if (option === "--replay") {
                options.token = value;
            }
            else {
                if (option === "--report") {
                    options.report = value;
                }
                else {
                    const workers = readWorkers(value);
                    if (!workers) {
                        return failedOptions("bad-workers", `The option --workers takes a whole number from 1 up, and "${value}" is not one.`);
                    }
                    options.workers = workers;
                }
            }
        }
    }
    return {
        ok: true,
        value: options,
    };
}

//
// The number of workers `text` names, or undefined when it is not a whole number from 1 up.
//
export function readWorkers(text: string): number | undefined {
    if (!/^[1-9][0-9]*$/.test(text)) {
        return undefined;
    }
    const workers = Number(text);
    if (!Number.isSafeInteger(workers)) {
        return undefined;
    }
    assert(workers > 0);
    return workers;
}

//
// How the value of `option` is written in a sentence that shows how to type it.
//
export function placeholderOf(option: string): string {
    assert(valueOptions.includes(option));
    if (option === "--replay") {
        return "\"<token>\"";
    }
    if (option === "--function") {
        return "<name>";
    }
    if (option === "--workers") {
        return "<n>";
    }
    return "<path>";
}

//
// A command line that could not be read, with the reason.
//
export function failedOptions(name: IOptionsError["name"], message: string): IOptionsFailed {
    assert(/^[A-Z]/.test(message));
    assert(message.endsWith("."));
    return {
        ok: false,
        error: {
            name,
            message,
        },
    };
}
