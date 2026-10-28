//
// Shows where a failure happened, in the way Elm and Rust show an error: the file, line and column,
// the values the call was made with, the failure Faultline injected, the project's own code with a
// mark under the place, the stack trace from the command down to the failure and a hint for that
// kind of crash.
//
// It works from what the call that failed sent back: the failure with the error's stack, and each
// value the call was made with as it was written before the call.
//

import assert from "node:assert/strict";
import path from "node:path";
import { framesOf, isOwnFile, isUnbuiltValues, ownFrame, type IFailure, type IFrame } from "../run/judge.ts";
import { readToken } from "../run/token.ts";
import { failureGroups } from "../world/failures.ts";

//
// How wide the heading of a crash is, so it ends where the rest of the output does.
//
const headingWidth = 100;

//
// Everything the view of one failure shows.
//
export interface ICrashView {
    //
    // The failure.
    //
    failure: IFailure;

    //
    // Each value the call was made with, in parameter order, as the call wrote it.
    //
    arguments: string[];

    //
    // The absolute path of the project, whose files the code is shown from.
    //
    projectRoot: string;

    //
    // Reads the text of a project file by its absolute path, or gives undefined when it cannot.
    //
    readSource(file: string): string | undefined;

    //
    // The command the failure started from, shown at the root of the stack trace: `npx flt` for a
    // run, or the replay command for a replay.
    //
    command: string;
}

//
// The lines of the view of one failure. A failure with no stack in the project's own files is its
// sentence alone, with its place when it has one.
//
export function writeCrashView(view: ICrashView): string[] {
    const failure = view.failure;
    const frame = ownFrame(view.projectRoot, failure.stack);
    const lines: string[] = [];
    if (frame === undefined) {
        lines.push(...messageLines(failure.location === "" ? failure.message : `${failure.message} (${failure.location})`));
        lines.push(...calledWith(view.arguments), ...injectedLines(failure.token));
        return lines;
    }
    const relative = path.relative(view.projectRoot, frame.file).split(path.sep).join("/");
    const place = `${relative}:${frame.line}:${frame.column}`;
    const heading = `-- ${failure.kind === "crash" ? "CRASH" : "UNCAUGHT ERROR"} ${place} `;
    lines.push(heading.padEnd(headingWidth, "-"));
    lines.push(...messageLines(failure.message));
    lines.push(...calledWith(view.arguments), ...injectedLines(failure.token));
    const text = view.readSource(frame.file);
    const code = text === undefined ? undefined : text.split("\n")[frame.line - 1];
    if (code !== undefined) {
        const number = String(frame.line);
        lines.push("");
        lines.push(`  ${number} | ${code}`);
        lines.push(`  ${" ".repeat(number.length)} | ${" ".repeat(frame.column - 1)}^`);
    }
    lines.push("");
    lines.push("  Stack trace:");
    for (const one of projectFrames(view.projectRoot, failure.stack)) {
        const shown = isOwnFile(view.projectRoot, one.file) ? path.relative(view.projectRoot, one.file).split(path.sep).join("/") : one.file;
        lines.push(`    at ${shown}:${one.line}:${one.column}`);
    }
    lines.push(`    at ${view.command}`);
    lines.push("");
    lines.push(`  Hint: ${hintOf(failure)}`);
    return lines;
}

//
// A failure's sentence as the lines it is printed on. An error's message, and what a child process
// wrote before it ended, can run over several lines, and every line printed holds no line break of
// its own.
//
export function messageLines(message: string): string[] {
    assert(message.length > 0);
    const lines = message.split("\n");
    assert(lines.length > 0);
    assert(lines.every((line) => !line.includes("\n")));
    return lines;
}

//
// The frames of a stack from the innermost down to the last one in the project's own files. The
// frames below that are Faultline's own on its way from the command to the call, wherever it is
// installed, and say nothing about the code.
//
export function projectFrames(projectRoot: string, stack: string): IFrame[] {
    const frames = framesOf(stack);
    let last = -1;
    frames.forEach((frame, index) => {
        if (isOwnFile(projectRoot, frame.file)) {
            last = index;
        }
    });
    return frames.slice(0, last + 1);
}

//
// The lines that say what the call was made with, none when it took no values.
//
export function calledWith(values: string[]): string[] {
    if (values.length === 0) {
        return [];
    }
    return ["", "  Called with:", ...values.map((value, index) => `    argument ${index + 1}: ${value}`)];
}

//
// The lines that say which failure Faultline injected, none when the call injected none.
//
export function injectedLines(token: string): string[] {
    const sentence = injectedFailure(token);
    if (sentence === undefined) {
        return [];
    }
    return ["", `  Injected: ${sentence}`];
}

//
// The failure a token injects, as what Faultline made happen: `the 2nd read call failed with "Input
// or output error".` for `read#1/input-or-output-error`. A token counts the calls of an effect from
// zero and the sentence from one. It is undefined for a token that injects none or cannot be read.
//
export function injectedFailure(token: string): string | undefined {
    const read = readToken(token);
    if (!read.ok || read.value.failure === undefined) {
        return undefined;
    }
    const planned = read.value.failure;
    const group = failureGroups.find((one) => one.effect === planned.place.effect);
    assert(group !== undefined);
    const kind = group.kinds.find((one) => one.id === planned.failure);
    assert(kind !== undefined);
    const count = planned.place.occurrence + 1;
    return `the ${count}${ordinalSuffix(count)} ${planned.place.effect} call failed with "${kind.description}".`;
}

//
// The letters after a number counted in words: `st` for 1, `nd` for 2, `rd` for 3 and `th` for the
// rest, `th` also for 11, 12 and 13.
//
export function ordinalSuffix(count: number): string {
    assert(Number.isInteger(count) && count > 0);
    if (count % 100 >= 11 && count % 100 <= 13) {
        return "th";
    }
    if (count % 10 === 1) {
        return "st";
    }
    if (count % 10 === 2) {
        return "nd";
    }
    if (count % 10 === 3) {
        return "rd";
    }
    return "th";
}

//
// What to do about a failure, read from the first line of its error's stack. One or two sentences,
// written for whoever fixes the code.
//
export function hintOf(failure: IFailure): string {
    if (failure.kind === "uncaught") {
        return "Work the call started threw and no code caught it. Await the promise the work returns, or catch the error where the work starts.";
    }
    if (isUnbuiltValues(failure)) {
        return "Building a value for the call failed on this line, so the function was never called. Make the value factory return a value of its type.";
    }
    const first = failure.stack.split("\n")[0]!;
    if (/^TypeError: Cannot read properties of (undefined|null)/.test(first)) {
        return "This line reads a property of a value that was undefined or null. Check for it first, or make sure no caller can pass it.";
    }
    if (/^TypeError: Cannot set properties of (undefined|null)/.test(first)) {
        return "This line sets a property of a value that was undefined or null. Check for it first, or make sure no caller can pass it.";
    }
    if (/^TypeError: .* is not a function/.test(first)) {
        return "This line calls something that is not a function. Check what it holds before calling it.";
    }
    if (/^TypeError: .* is not iterable/.test(first)) {
        return "This line loops over or spreads a value that cannot be iterated. Check it is an array or another iterable first.";
    }
    if (first.startsWith("TypeError:")) {
        return "This line uses a value in a way its type does not allow. Check the value before using it.";
    }
    if (first.startsWith("ReferenceError:")) {
        return "This line names a variable that is not declared, or uses one before the line that declares it. Declare it, or move the use after the declaration.";
    }
    if (first.startsWith("RangeError: Maximum call stack size exceeded")) {
        return "This function calls itself without end for these values. Make sure every path of the recursion reaches a case that stops it.";
    }
    if (first.startsWith("RangeError: Invalid array length")) {
        return "This line makes an array of a length that cannot be. Check the length is a whole number from 0 up before using it.";
    }
    return "A value on this line is outside the range the operation accepts. Check it before the operation.";
}
