//
// What a run prints when it is not finished: one line per thing somebody has to do, each a sentence
// carrying the file and line and the one thing to write there.
//
// The rest of the report says what happened. This says what to do about it, which is what somebody
// reading a run that did not reach 100% needs.
//

import assert from "node:assert/strict";
import { isSimFile } from "../discover/sources.ts";
import type { IShardResult } from "../run/explore.ts";
import type { IPathRecord } from "../run/messages.ts";
import { numberWord, plural } from "./style.ts";

//
// What kind of work one checklist item asks for.
//
export type ChecklistKind = "value-factory" | "uncallable" | "scenario";

//
// One thing to do. A field a kind does not use is the empty string.
//
export interface IChecklistItem {
    //
    // What kind of work it asks for: a value factory for a type no value can be built for, a
    // scenario that calls a function Faultline cannot call, or a value factory or scenario that
    // reaches a code path no call exercised.
    //
    kind: ChecklistKind;

    //
    // The file the work is in, relative to the project root.
    //
    file: string;

    //
    // The line the work is at.
    //
    line: number;

    //
    // The function the work is in, as the report labels it.
    //
    fn: string;

    //
    // What the code path is, for a scenario item.
    //
    describe: string;

    //
    // The type the value factory has to return, for a value factory item.
    //
    typeName: string;

    //
    // What stops Faultline calling the function, for an uncallable item.
    //
    because: string;
}

//
// The order kinds are printed in: what stops a function being called at all comes first, because
// no code path inside it can be worked on until it is done.
//
export const kindOrder: ChecklistKind[] = ["value-factory", "uncallable", "scenario"];

//
// How many items a terminal gets. The rest are in the report file, which holds every one. Ten,
// because the list is in the order the work is worth doing in and a first run against a project
// with no sim files has a long list: printing all of it buries the coverage number and the path of
// the file that holds the rest. Ten is enough to start on and short enough to read.
//
export const terminalLimit = 10;

//
// Every thing to do for the source files of `shards`, given the keys of the code paths the run
// exercised, in kind order and within a kind in shard order and then in the order the file lists
// them. A function no call can reach gets one item for the whole function, and none for each of
// its code paths, because one value factory or one scenario reaches them all.
//
export function checklistItems(shards: IShardResult[], exercised: Set<string>): IChecklistItem[] {
    const items: IChecklistItem[] = [];
    for (const shard of shards) {
        if (isSimFile(shard.facts.file)) {
            continue;
        }
        items.push(...shardItems(shard, exercised));
    }
    const ordered = kindOrder.flatMap((kind) => items.filter((item) => item.kind === kind));
    assert.equal(ordered.length, items.length);
    return ordered;
}

//
// The things to do in one source file's shard, in the order the file lists them.
//
export function shardItems(shard: IShardResult, exercised: Set<string>): IChecklistItem[] {
    const facts = shard.facts;
    const missed = facts.paths.filter((record) => !exercised.has(record.key));
    const items: IChecklistItem[] = [];
    const whole = new Set<string>();
    for (const plan of facts.functions) {
        if (!missed.some((record) => record.fn === plan.label)) {
            continue;
        }
        if (plan.uncallable) {
            whole.add(plan.label);
            items.push(checkedItem({
                kind: "uncallable",
                file: facts.file,
                line: plan.line,
                fn: plan.label,
                describe: "",
                typeName: "",
                because: plan.uncallable,
            }));
            continue;
        }
        if (plan.unbuildable) {
            whole.add(plan.label);
            items.push(checkedItem({
                kind: "value-factory",
                file: facts.file,
                line: plan.line,
                fn: plan.label,
                describe: "",
                typeName: plan.unbuildable,
                because: "",
            }));
        }
    }
    for (const uncallable of facts.uncallable) {
        if (whole.has(uncallable.label)) {
            continue;
        }
        if (!missed.some((record) => record.fn === uncallable.label)) {
            continue;
        }
        whole.add(uncallable.label);
        items.push(checkedItem({
            kind: "uncallable",
            file: facts.file,
            line: uncallable.line,
            fn: uncallable.label,
            describe: "",
            typeName: "",
            because: uncallable.because,
        }));
    }
    for (const record of missed) {
        if (!whole.has(record.fn)) {
            items.push(pathItem(record));
        }
    }
    assert(items.length <= missed.length + facts.functions.length + facts.uncallable.length);
    return items;
}

//
// The item that asks for a value factory or a scenario reaching one code path.
//
export function pathItem(record: IPathRecord): IChecklistItem {
    assert(record.key.startsWith(`${record.file}\t`), `${record.key} is not the key of a path in ${record.file}.`);
    assert(record.describe.length > 0);
    return checkedItem({
        kind: "scenario",
        file: record.file,
        line: record.line,
        fn: record.fn,
        describe: record.describe,
        typeName: "",
        because: "",
    });
}

//
// `item`, once checked to name a place in a file, so no item points nowhere.
//
export function checkedItem(item: IChecklistItem): IChecklistItem {
    assert(item.file.length > 0);
    assert(item.line > 0, `${item.fn} in ${item.file} is on line ${item.line}, and lines count from 1.`);
    return item;
}

//
// The sentence that says what to do about `item`, so it can be acted on without the rest of the
// report being read.
//
export function sentenceOf(item: IChecklistItem): string {
    assert(kindOrder.includes(item.kind));
    assert(item.line > 0);
    if (item.kind === "value-factory") {
        return `Write a value factory returning ${item.typeName}, which ${item.fn} takes. Without one, ${item.fn} at ${item.file}:${item.line} cannot be called at all.`;
    }
    if (item.kind === "uncallable") {
        return `Write a scenario that calls ${item.fn} at ${item.file}:${item.line}. Faultline cannot call it itself, because ${item.because}.`;
    }
    return `Write a value factory that reaches ${item.describe} at ${item.file}:${item.line} in ${item.fn}, or a scenario that exercises it if no value factory can.`;
}

//
// What to write for every item of a kind, said once over a list of them.
//
export function headingOf(kind: ChecklistKind): string {
    assert(kindOrder.includes(kind));
    if (kind === "value-factory") {
        return "Each of these types needs a value factory of its own, so the function that takes it can be called:";
    }
    if (kind === "uncallable") {
        return "Each of these functions needs a scenario of its own that calls it, because Faultline cannot call it itself:";
    }
    return "Each of these code paths needs a value factory that reaches it or, where no value factory can, a scenario of its own:";
}

//
// One item under its kind's heading: only what tells it from the others.
//
export function shortLineOf(item: IChecklistItem): string {
    assert(kindOrder.includes(item.kind));
    assert(item.file.length > 0);
    if (item.kind === "value-factory") {
        return `${item.typeName}, for ${item.fn} at ${item.file}:${item.line}`;
    }
    if (item.kind === "uncallable") {
        return `${item.fn} at ${item.file}:${item.line}, because ${item.because}`;
    }
    return `${item.describe} at ${item.file}:${item.line} in ${item.fn}`;
}

//
// The lines the terminal gets: a blank line, a heading saying how many items there are, then at
// most `terminalLimit` items grouped by kind, and a line saying how many more the report file
// holds. A kind with more than one item shown says what to write once, over a short line per item.
// No items gives no lines.
//
export function checklistLines(items: IChecklistItem[]): string[] {
    if (items.length === 0) {
        return [];
    }
    const lines = ["", `  ${numberWord(items.length)} ${plural(items.length, "thing", "things")} to do:`];
    let printed = 0;
    for (const kind of kindOrder) {
        const ofKind = items.filter((one) => one.kind === kind);
        const shown = ofKind.slice(0, terminalLimit - printed);
        if (shown.length === 1) {
            lines.push(`    ${sentenceOf(shown[0]!)}`);
        }
        if (shown.length > 1) {
            lines.push(`    ${headingOf(kind)}`);
            lines.push(...shown.map((one) => `      ${shortLineOf(one)}`));
        }
        printed += shown.length;
    }
    assert(printed <= terminalLimit);
    if (items.length > printed) {
        lines.push(`    and ${items.length - printed} more.`);
    }
    return lines;
}

//
// The lines the report file gets: every item, one line each in the order the terminal lists them,
// each starting with `to do`, so the file holds the items the terminal leaves out.
//
export function checklistFileLines(items: IChecklistItem[]): string[] {
    const lines = items.map((one) => `to do ${sentenceOf(one)}`);
    assert.equal(lines.length, items.length);
    return lines;
}
