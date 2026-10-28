//
// Writes the lines of the report file, which lists every code path and what became of it, every
// failure with the command that repeats it, every thing to do and every file the walk left out.
//

import assert from "node:assert/strict";
import type { NotProvable } from "../coverage/paths.ts";
import type { ISkippedFile } from "../discover/sources.ts";
import type { IShardResult } from "../run/explore.ts";
import type { IFailure } from "../run/judge.ts";
import type { IPathRecord } from "../run/messages.ts";
import { checklistFileLines, type IChecklistItem } from "./checklist.ts";

// The line the report file gives one code path no range can prove ran, laid out like the lines it
// gives every other path: the state, where the path is, its name and the function it belongs to.
export function notProvableLine(path: NotProvable): string {
    assert(path.line > 0);
    assert(path.name.length > 0);
    return `not provable ${path.file}:${path.line} ${path.name} in ${path.fn}`;
}

//
// The line the report file gives one code path a count can prove ran: whether some call exercised
// it, where it is, its name and the function it belongs to.
//
export function pathLine(record: IPathRecord, isExercised: boolean): string {
    assert(record.line > 0);
    assert(record.key.startsWith(`${record.file}\t`), `${record.key} is not the key of a path in ${record.file}.`);
    const name = record.key.slice(record.file.length + 1);
    assert(name.length > 0);
    return `${isExercised ? "exercised" : "not exercised"} ${record.file}:${record.line} ${name} in ${record.fn}`;
}

//
// The two lines the report file gives one failure: what failed and the command that repeats it.
//
export function failureFileLines(failure: IFailure): string[] {
    assert(failure.token.length > 0);
    assert(failure.message.length > 0);
    return [`failed ${failure.kind}: ${failure.message}`, `  replay with npx flt --replay "${failure.token}"`];
}

//
// The line the report file gives one file or directory the walk left out.
//
export function skippedLine(skipped: ISkippedFile): string {
    assert(skipped.file.length > 0);
    assert(skipped.because.length > 0);
    return `skipped ${skipped.file}, because ${skipped.because}.`;
}

//
// What the report file holds.
//
export interface IReportFileParts {
    //
    // What every shard of the run found, in shard order.
    //
    shards: IShardResult[];

    //
    // The keys of every code path some call exercised.
    //
    exercised: Set<string>;

    //
    // Every failure the run reports.
    //
    failures: IFailure[];

    //
    // Every thing to do.
    //
    items: IChecklistItem[];

    //
    // Every file and directory the walk left out.
    //
    skipped: ISkippedFile[];
}

//
// The whole text of the report file: every code path of every source file in shard order, then
// every failure, every thing to do and every file left out, one line each and ending with a newline.
//
export function reportFileText(parts: IReportFileParts): string {
    const lines: string[] = [];
    for (const shard of parts.shards) {
        for (const record of shard.facts.paths) {
            lines.push(pathLine(record, parts.exercised.has(record.key)));
        }
        lines.push(...shard.facts.notProvable.map((path) => notProvableLine(path)));
    }
    for (const failure of parts.failures) {
        lines.push(...failureFileLines(failure));
    }
    lines.push(...checklistFileLines(parts.items));
    lines.push(...parts.skipped.map((skipped) => skippedLine(skipped)));
    assert(lines.length >= parts.items.length + parts.failures.length * 2);
    return lines.map((line) => `${line}\n`).join("");
}
