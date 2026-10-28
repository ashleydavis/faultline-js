//
// Decides which outcomes of a call are failures, and gives each failure a key that is the same for
// the same defect, so a defect several calls reach is reported once.
//
// A call that throws or rejects has not failed, because throwing is how JavaScript reports an
// error. A call has crashed when the engine raised a `TypeError`, `ReferenceError` or `RangeError`
// at a line of the project's own source. An error the code built itself with `new TypeError(...)`
// is a report, not a crash, and so is one raised inside a package or inside Node.
//

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

//
// How a call failed.
//
export type FailureKind = "crash" | "uncaught" | "hang" | "expectation";

//
// One failure a call found.
//
export interface IFailure {
    //
    // How the call failed.
    //
    kind: FailureKind;

    //
    // A sentence saying what failed, for the report.
    //
    message: string;

    //
    // Where it happened, as `<file>:<line>` relative to the project root, or the empty string when
    // no line of the project says where.
    //
    location: string;

    //
    // The same for every call that found the same defect.
    //
    key: string;

    //
    // The replay token of the call that found it.
    //
    token: string;

    //
    // The stack trace of the error, for the crash view, or the empty string when no error was
    // raised: a call that never settled, a child process that ended, a shard that failed to open or
    // an expectation.
    //
    stack: string;
}

//
// What one call gave: every failure it found and the values it was made with. The answers of the
// calls behind kept crashes are kept with their shard's result, because a call goes the same way
// every time its shard has the same key, so a later run with that key answers a kept crash and
// shows its crash view from the answer without making the call again.
//
export interface ICallAnswer {
    //
    // The replay token of the call.
    //
    token: string;

    //
    // Every failure the call found.
    //
    failures: IFailure[];

    //
    // Each value the call was made with, as the crash view shows it.
    //
    arguments: string[];
}

//
// One line of a stack trace that names a file.
//
export interface IFrame {
    //
    // The absolute path of the file.
    //
    file: string;

    //
    // The line, counting from one.
    //
    line: number;

    //
    // The column, counting from one.
    //
    column: number;
}

//
// What a judgement is made against.
//
export interface IJudgeContext {
    //
    // The absolute path of the project being fault tested.
    //
    projectRoot: string;

    //
    // Reads the text of a project file, so a frame can be checked for the code building the error
    // itself. It is undefined for a file that cannot be read.
    //
    readSource(file: string): Promise<string | undefined>;
}

//
// The errors the engine raises when the code does something it cannot: read a property of
// `undefined`, call what is not a function, name what is not declared, recurse past the stack or
// make an array of a length that cannot be.
//
const crashNames = ["TypeError", "ReferenceError", "RangeError"];

//
// The name of the engine error `error` is, or undefined when it is no error the engine raises. A
// class that extends one of them is the code's own, because the engine raises only the classes
// themselves.
//
export function crashNameOf(error: unknown): string | undefined {
    if (!isError(error)) {
        return undefined;
    }
    const name = error.constructor.name;
    if (!crashNames.includes(name)) {
        return undefined;
    }
    if (error.name !== name) {
        return undefined;
    }
    return name;
}

//
// Whether a value is an error, from whichever realm made it: code run in another context has an
// `Error` class of its own, which `instanceof` against this one does not see.
//
export function isError(value: unknown): value is Error {
    return Object.prototype.toString.call(value) === "[object Error]";
}

//
// Every frame of a stack trace that names a file, in order. Frames of Node's own modules and of
// functions built into the engine name no file and are left out.
//
export function framesOf(stack: string): IFrame[] {
    const frames: IFrame[] = [];
    for (const written of stack.split("\n")) {
        const matched = /^\s*at (?:.* \()?(.+?):(\d+):(\d+)\)?$/.exec(written);
        if (matched === null) {
            continue;
        }
        const file = fileOfFrame(matched[1]!);
        if (file === undefined) {
            continue;
        }
        frames.push({
            file,
            line: Number(matched[2]),
            column: Number(matched[3]),
        });
    }
    return frames;
}

//
// The absolute path a frame's location names, without the query a fresh import adds, or undefined
// when it names no file.
//
export function fileOfFrame(location: string): string | undefined {
    if (location.startsWith("file:")) {
        return fileURLToPath(location.split("?")[0]!);
    }
    if (!path.isAbsolute(location)) {
        return undefined;
    }
    return location.split("?")[0]!;
}

//
// Whether `file` is the project's own: inside the project and outside every installed package.
//
export function isOwnFile(projectRoot: string, file: string): boolean {
    const relative = path.relative(projectRoot, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return false;
    }
    return !relative.split(path.sep).includes("node_modules");
}

//
// Where a frame is, as `<file>:<line>` relative to the project root.
//
export function locationOf(projectRoot: string, frame: IFrame): string {
    assert(frame.line > 0);
    return `${path.relative(projectRoot, frame.file).split(path.sep).join("/")}:${frame.line}`;
}

//
// The first frame of a stack trace that names a file, when it is one of the project's own files.
// It is undefined when the first file named is a package's, Node's or the tool's, or when the stack
// names no file.
//
export function ownFirstFrame(projectRoot: string, stack: string): IFrame | undefined {
    const first = framesOf(stack)[0];
    if (first === undefined || !isOwnFile(projectRoot, first.file)) {
        return undefined;
    }
    return first;
}

//
// The first frame of a stack trace in one of the project's own files, wherever it is in the trace.
//
export function ownFrame(projectRoot: string, stack: string): IFrame | undefined {
    return framesOf(stack).find((frame) => isOwnFile(projectRoot, frame.file));
}

//
// Whether the code at a frame builds an error itself (`new TypeError(...)` or `TypeError(...)`),
// which is a report the code chose to make rather than something the engine raised.
//
export function isBuiltByCode(text: string, frame: IFrame): boolean {
    const line = text.split("\n")[frame.line - 1];
    if (line === undefined) {
        return false;
    }
    const from = line.slice(frame.column - 1);
    return /^(new\s+)?[A-Za-z_$][\w$]*Error\s*\(/.test(from);
}

//
// The crash an error that came out of a call is, or undefined when it is no crash.
//
export async function judgeThrown(context: IJudgeContext, error: unknown, subject: string, token: string): Promise<IFailure | undefined> {
    const name = crashNameOf(error);
    if (name === undefined) {
        return undefined;
    }
    // An error the engine raised is an `Error` with a stack, which `crashNameOf` has checked.
    const stack = (error as Error).stack ?? "";
    const frame = ownFirstFrame(context.projectRoot, stack);
    if (frame === undefined) {
        return undefined;
    }
    const text = await context.readSource(frame.file);
    if (text !== undefined && isBuiltByCode(text, frame)) {
        return undefined;
    }
    const location = locationOf(context.projectRoot, frame);
    return {
        kind: "crash",
        message: sentence(`${subject} crashed with ${name}: ${(error as Error).message}`),
        location,
        key: `crash|${name}|${location}:${frame.column}`,
        token,
        stack,
    };
}

//
// The failure an error that no code caught is: one raised by work the call started, such as a timer
// or a promise nobody waited for.
//
export function judgeUncaught(context: IJudgeContext, error: unknown, subject: string, token: string): IFailure {
    const described = describeError(error);
    const stack = isError(error) ? (error.stack ?? "") : "";
    const frame = ownFrame(context.projectRoot, stack);
    const location = frame === undefined ? "" : locationOf(context.projectRoot, frame);
    return {
        kind: "uncaught",
        message: sentence(`${subject} left an error that no code caught: ${described}`),
        location,
        key: `uncaught|${isError(error) ? error.name : typeof error}|${location}`,
        token,
        stack,
    };
}

//
// The failure of the calls of a shard whose file the child could not open: the child ended while
// opening it, saying `ended`. It is reported from what the open said rather than by opening the
// file again, because one open of a file that fails can take minutes, so it is never replayed and
// never kept as a crash for the next run to replay.
//
export function judgeFailedOpen(file: string, subject: string, ended: string, token: string): IFailure {
    assert(file.length > 0);
    assert(ended.length > 0);
    return {
        kind: "crash",
        message: `${subject} was not made, because the child process opening ${file} ended ${ended}.`,
        location: "",
        key: `open|${file}`,
        token,
        stack: "",
    };
}

//
// The failure of a call whose values could not be built: a value factory threw, or building or
// writing out a value failed. The function was never called, so this is reported rather than
// taken for the function throwing, which is no failure, and no call is left out without a word.
//
export function judgeUnbuiltValues(file: string, name: string, subject: string, error: unknown, token: string): IFailure {
    assert(file.length > 0);
    assert(name.length > 0);
    const described = describeError(error);
    return {
        kind: "crash",
        message: sentence(`${subject} was not made, because building its values failed with ${described}`),
        location: "",
        key: `values|${file}|${name}|${described}`,
        token,
        stack: isError(error) ? error.stack ?? "" : "",
    };
}

//
// Whether a failure is that of a call whose values could not be built, which `judgeUnbuiltValues`
// makes.
//
export function isUnbuiltValues(failure: IFailure): boolean {
    assert(failure.key.length > 0);
    return failure.key.startsWith("values|");
}

//
// Whether a failure is that of a shard whose file the child could not open, which `judgeFailedOpen`
// makes.
//
export function isFailedOpen(failure: IFailure): boolean {
    assert(failure.key.length > 0);
    return failure.key.startsWith("open|");
}

//
// The failure of a call that never settled.
//
export function judgeHang(file: string, name: string, subject: string, token: string): IFailure {
    return {
        kind: "hang",
        message: `${subject} never returned.`,
        location: "",
        key: `hang|${file}|${name}`,
        token,
        stack: "",
    };
}

//
// The failure of an expectation that did not hold. `location` is where the expectation was made.
//
export function judgeExpectation(expectation: string, owner: string, location: string, token: string): IFailure {
    return {
        kind: "expectation",
        message: sentence(`The expectation "${expectation}" in ${owner} did not hold`),
        location,
        key: `expectation|${location}|${expectation}`,
        token,
        stack: "",
    };
}

//
// An error written the way the report prints it: its name and message, or the value itself for
// something thrown that is not an error.
//
export function describeError(error: unknown): string {
    if (isError(error)) {
        return `${error.name}: ${error.message}`;
    }
    return String(error);
}

//
// Text ending in a full stop, adding one when it has none.
//
export function sentence(text: string): string {
    if (text.endsWith(".")) {
        return text;
    }
    return `${text}.`;
}

//
// How the report names what was called: "The call to <function>" or "The scenario <name>".
//
export function subjectOf(isScenario: boolean, name: string): string {
    if (isScenario) {
        return `The scenario ${name}`;
    }
    return `The call to ${name}`;
}
