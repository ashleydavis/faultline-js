// Reads what V8 says ran.
//
// Node writes this to the directory NODE_V8_COVERAGE names, and Chromium hands the same thing over
// its debugging protocol, so one reader serves a run in either.
//
// V8 reports ranges over the file it executed, which is the transpiled copy. A code path is written
// in the file somebody wrote. Going from one to the other is what this module does.

import { TraceMap, generatedPositionFor } from "@jridgewell/trace-mapping";

// One range V8 reported, with how many times it ran.
export interface Range {
    // Where the range starts in the executed file, counted in characters.
    startOffset: number;

    // Where it ends.
    endOffset: number;

    // How many times it ran.
    count: number;
}

// One function V8 reported, with the ranges inside it.
export interface FunctionCoverage {
    // What the function is called. V8 leaves this empty for a module's top level.
    functionName: string;

    // Its ranges, outermost first.
    ranges: Range[];
}

// What V8 reported for one script.
export interface ScriptCoverage {
    // Where the script was loaded from.
    url: string;

    // The functions in it.
    functions: FunctionCoverage[];
}

// How many times the innermost range covering an offset ran.
//
// V8 nests its ranges: a function carries one for the whole of it, and one more for each block that
// ran a different number of times. The innermost range covering an offset is the one that says how
// often that offset ran.
export function countAt(script: ScriptCoverage, offset: number): number {
    let narrowest = Number.MAX_SAFE_INTEGER;
    let found = 0;
    let covered = false;
    for (const fn of script.functions) {
        for (const range of fn.ranges) {
            if (offset < range.startOffset || offset >= range.endOffset) {
                continue;
            }
            const width = range.endOffset - range.startOffset;
            if (width <= narrowest) {
                narrowest = width;
                found = range.count;
                covered = true;
            }
        }
    }
    if (!covered) {
        // An offset no range covers sits in a function V8 never entered, so it never ran.
        return 0;
    }
    return found;
}

// Adds what one reading counted into a running total for the same process.
//
// Taking coverage from V8 resets its counters, so a reading is what ran since the last one rather
// than everything that has run. A process that reads more than once has to add the readings up, or
// each one throws away what came before it.
//
// The two readings do not report the same ranges. V8 leaves out a block whose count matches the
// block around it, so a block that ran three times in one reading and three times in the next is a
// range of its own once and no range at all the second time. Adding range to range by where it
// starts and ends would read that as three. So every place either reading knows about is asked of
// both, through the same narrowest range lookup the report uses, and the two answers are added.
export function addInto(total: Map<string, ScriptCoverage>, taken: ScriptCoverage[]): void {
    for (const script of taken) {
        const held = total.get(script.url);
        if (held === undefined) {
            total.set(script.url, { url: script.url, functions: script.functions.map((one) => ({ ...one, ranges: [...one.ranges] })) });
            continue;
        }
        const byPlace = new Map<string, Range>();
        for (const range of [...everyRange(held), ...everyRange(script)]) {
            byPlace.set(`${range.startOffset}:${range.endOffset}`, { startOffset: range.startOffset, endOffset: range.endOffset, count: 0 });
        }
        for (const range of byPlace.values()) {
            range.count = countAt(held, range.startOffset) + countAt(script, range.startOffset);
        }
        // One function holding every range reads the same to `countAt`, which only ever looks for
        // the narrowest range covering an offset.
        total.set(script.url, { url: script.url, functions: [{ functionName: "", ranges: [...byPlace.values()] }] });
    }
}

// Every range of one script, whichever function V8 put it under.
function everyRange(script: ScriptCoverage): Range[] {
    return script.functions.flatMap((one) => one.ranges);
}

// Everything one run counted, kept apart by the process that counted it.
//
// Each process sends a running total of what it has counted, so the newest word from one process
// replaces what it said before. A second process starts from zero, so its counts are added to the
// first's rather than replacing them. A run starts a second process for every round past the first
// and after any unit that stopped one, and mixing the two up loses everything the earlier processes
// reached.
export type Taken = Map<number, Map<string, ScriptCoverage>>;

// Puts what one process has counted so far into the whole.
export function mergeInto(held: Taken, generation: number, taken: ScriptCoverage[]): void {
    let mine = held.get(generation);
    if (mine === undefined) {
        mine = new Map();
        held.set(generation, mine);
    }
    for (const script of taken) {
        mine.set(script.url, script);
    }
}

// How many times an offset of one script ran, over every process that ran it.
export function countAcross(held: Taken, url: string, offset: number): number {
    let total = 0;
    for (const mine of held.values()) {
        const script = mine.get(url);
        if (script !== undefined) {
            total += countAt(script, offset);
        }
    }
    return total;
}

// Turns a line and a column into an offset, for one file's text.
export class Offsets {
    // Where each line starts, counted in characters from the start of the file.
    private readonly lineStarts: number[];

    constructor(text: string) {
        this.lineStarts = [0];
        for (let index = 0; index < text.length; index += 1) {
            if (text[index] === "\n") {
                this.lineStarts.push(index + 1);
            }
        }
    }

    // The offset of a position, counting lines from one and columns from zero. It answers -1 for a
    // line the file does not have.
    offsetOf(line: number, column: number): number {
        const start = this.lineStarts[line - 1];
        if (start === undefined) {
            return -1;
        }
        return start + column;
    }
}

// Finds where a position in the file somebody wrote ended up in the file that ran.
export class Places {
    // The map the transpile wrote.
    private readonly map: TraceMap;

    // Turns a position in the executed file into an offset in it.
    private readonly offsets: Offsets;

    // The name the map gives the original file. It is read out of the map rather than passed in,
    // because the transpile names its source its own way and a name that does not match the map's
    // finds no position at all.
    private readonly source: string;

    constructor(mapText: string, generatedText: string) {
        const read = JSON.parse(mapText) as { sources: (string | null)[] };
        this.map = new TraceMap(read as ConstructorParameters<typeof TraceMap>[0]);
        this.offsets = new Offsets(generatedText);
        this.source = read.sources[0] ?? "";
    }

    // Where a line and column of the original file ended up in the file that ran, or -1 when the
    // transpile left it nowhere.
    generatedOffsetOf(line: number, column: number): number {
        // A bias of one takes the nearest mapping at or after the position asked for, so a position
        // the transpile moved slightly still lands inside the code it belongs to.
        const found = generatedPositionFor(this.map, { source: this.source, line, column, bias: 1 });
        if (found.line === null || found.column === null) {
            return -1;
        }
        return this.offsets.offsetOf(found.line, found.column);
    }
}

// Pulls the map out of a file that carries it inside itself, which is how the transpile writes it.
export function inlineMapOf(text: string): string | undefined {
    const marker = "//# sourceMappingURL=data:application/json;base64,";
    const at = text.lastIndexOf(marker);
    if (at < 0) {
        return undefined;
    }
    return Buffer.from(text.slice(at + marker.length).trim(), "base64").toString("utf8");
}
