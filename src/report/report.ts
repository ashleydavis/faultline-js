// Prints what a run found, and writes the full list to a file.
//
// The terminal gets a short report: what it drove, the coverage number, and the few things worth
// doing next. The full list goes to the file named on one line.

import fs from "node:fs";
import path from "node:path";
import type { DriveResult } from "../drive/host.ts";
import type { RunModel } from "../model.ts";
import { checklistFor, missedHeading, missedLine, type Checklist } from "./checklist.ts";
import { elapsed, numberWord, padded, percentageOf, plural } from "./style.ts";
import type { RunTally } from "./tally.ts";

// How wide a function's name is padded to, so the counts beside it line up. Thirty five is the
// longest name in the repository this was first run against, rounded up to the next five.
const nameWidth = 35;

// Everything the report is written from.
export interface ReportInput {
    // The model the run was driven from.
    model: RunModel;

    // What the driving came back with.
    result: DriveResult;

    // What ran, put together.
    tally: RunTally;

    // How many files the walk found, including the ones with no function in them.
    found: number;

    // The files the walk left out, each with the reason.
    skipped: { file: string; because: string }[];

    // Where the full list was written.
    reportFile: string;

    // How long the run took, in milliseconds.
    took: number;

    // Whether every function gets a line, rather than only the ones with a path left.
    all: boolean;
}

// What a report came to.
export interface Verdict {
    // Every line the run printed, in order.
    lines: string[];

    // What the process exits with. It is zero only at a hundred per cent.
    status: number;
}

// Writes the report.
export function report(input: ReportInput): Verdict {
    const lines: string[] = [];
    const say = (text = ""): void => {
        lines.push(text);
    };
    const checklist = checklistFor(input.tally);
    const functionCount = input.tally.files.reduce((total, one) => total + one.functions.length, 0);

    say();
    say("Deterministic simulation");
    say();

    let complete = 0;
    for (const file of input.tally.files) {
        const worth = input.all ? file.functions : file.functions.filter((one) => one.ticked !== one.paths.length);
        complete += file.functions.filter((one) => one.ticked === one.paths.length).length;
        if (worth.length === 0) {
            continue;
        }
        say(`  ${file.file}`);
        for (const held of worth) {
            const mark = held.ticked === held.paths.length ? "ok  " : "MISS";
            const counts = `${held.ticked}/${held.paths.length} ${plural(held.paths.length, "path", "paths")}`;
            const calls = held.calls === 0 ? ", never called" : `, ${held.calls} ${plural(held.calls, "call", "calls")}`;
            say(`    ${mark} ${padded(held.held.label, nameWidth)}${counts}${calls}`);
        }
        say();
    }

    if (!input.all && complete > 0) {
        say(
            `  ${complete} ${plural(complete, "function", "functions")} covered every path, and ${plural(complete, "is", "are")} not listed above.`,
        );
        say();
    }

    say(summaryLine(input, functionCount));
    say(`  ${faultLine(input.model)}`);
    if (input.result.stepped > 0 || input.result.hung > 0 || input.result.died > 0) {
        say(`  ${steppedLine(input.result)}`);
    }
    say(`  ${sweptLine(input)}`);
    if (input.result.rounds > 1) {
        say(`  Drove ${input.result.rounds} rounds, each one after the first exploring only the functions with a path left.`);
    }
    for (const one of input.tally.empty) {
        say(`    ${one} declares no function, so there is no code in it to exercise.`);
    }
    for (const one of input.skipped) {
        say(`    ${one.file} was left out because ${one.because}.`);
    }
    say(`  Full detail is in ${input.reportFile}.`);
    if (input.model.unseen.length > 0) {
        const count = input.model.unseen.length;
        say();
        say(`  ${count} ${plural(count, "branch is", "branches are")} left out of the count above, because V8 reports no count`);
        say("  for a condition a loop tests every turn.");
    }
    say();

    sayChecklist(say, checklist);

    const percentage = percentageOf(input.tally.ticked, input.tally.total);
    say(`  Coverage: ${input.tally.ticked} of ${input.tally.total} ${plural(input.tally.total, "path", "paths")}, ${percentage}%.`);
    say();

    if (percentage === 100) {
        say("  Passed: every code path ran.");
        say(`  Took ${elapsed(input.took)}.`);
        return { lines, status: 0 };
    }

    const left = input.tally.total - input.tally.ticked;
    say(`  Failed: ${left} code ${plural(left, "path", "paths")} of ${input.tally.total} ${plural(left, "was", "were")} never reached.`);
    say("  The list above says what to do about each one.");
    say(`  Took ${elapsed(input.took)}.`);
    return { lines, status: 1 };
}

// The paths no call reached, and the things to do about them.
function sayChecklist(say: (text?: string) => void, checklist: Checklist): void {
    if (checklist.missed.length > 0) {
        say(`  ${missedHeading(checklist.missed.length)}`);
        for (const one of checklist.missed) {
            say(`      ${missedLine(one)}`);
        }
        say();
    }
    if (checklist.todo.length === 0) {
        return;
    }
    say(`  ${numberWord(checklist.todo.length)} ${plural(checklist.todo.length, "thing", "things")} to do:`);
    for (const one of checklist.todo) {
        say(`    ${one}`);
    }
    say();
}

// The one line saying what the run found and how much of it ran.
function summaryLine(input: ReportInput, functionCount: number): string {
    const tested = input.tally.files.length;
    const empty = input.tally.empty.length;
    const emptyPart = empty === 0 ? "" : ` with ${empty} having no function in ${plural(empty, "it", "them")}`;
    return `  Found ${input.found} source ${plural(input.found, "file", "files")}, tested ${tested}${emptyPart}, exercised ${functionCount} ${plural(functionCount, "function", "functions")} and executed ${input.tally.ticked} of ${input.tally.total} ${plural(input.tally.total, "path", "paths")}.`;
}

// The one line saying what was broken underneath the code while it ran.
function faultLine(model: RunModel): string {
    const faulting = model.seeds.length - 1;
    if (faulting <= 0) {
        return "Every call ran against effects that answered, because the run swept one seed and the first seed breaks nothing.";
    }
    return `One seed ran against effects that answered, and ${faulting} against a network that refuses connections, a file system that fails, a writer that takes only part of what it was given and a clock that jumps, one call in 4.`;
}

// The one line saying how many seeds were swept and what held while they were.
function sweptLine(input: ReportInput): string {
    const seeds = input.model.seeds.length;
    const swept = `Swept ${seeds} ${plural(seeds, "seed", "seeds")}`;
    const held = input.model.invariants.length;
    if (held === 0) {
        return `${swept}, with no scenario reporting a wrong answer.`;
    }
    return `${swept}, with no scenario reporting a wrong answer and ${held} ${plural(held, "invariant", "invariants")} holding after every call.`;
}

// The one line saying what the run stepped over.
function steppedLine(result: DriveResult): string {
    const parts = [
        `Stepped over ${result.stepped} ${plural(result.stepped, "call", "calls")} for throwing on an input the function was never written for`,
    ];
    if (result.hung > 0) {
        parts.push(`stopped ${result.hung} ${plural(result.hung, "unit", "units")} that ran past the budget without returning`);
    }
    if (result.died > 0) {
        parts.push(
            `started again after ${result.died} ${plural(result.died, "unit", "units")} that ended the run themselves, as a module whose top level ends the process does`,
        );
    }
    return `${parts.join(", and ")}. The paths they would have covered are not in the count above.`;
}

// Writes the full list: every path, ticked or not, with its file and its line.
export function writeDetail(file: string, tally: RunTally): void {
    const lines: string[] = ["Every code path the run found, ticked when a call reached it.", ""];
    for (const one of tally.files) {
        lines.push(one.file);
        for (const held of one.functions) {
            lines.push(`  ${held.held.label} (${held.ticked}/${held.paths.length} paths, ${held.calls} calls)`);
            for (const site of held.paths) {
                lines.push(`    [${site.ticked ? "x" : " "}] ${one.file}:${site.site.line} "${site.site.name}" ${site.site.describe}`);
            }
        }
        lines.push("");
    }
    lines.push(`Coverage: ${tally.ticked} of ${tally.total} paths, ${percentageOf(tally.ticked, tally.total)}%.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join("\n")}\n`);
}
