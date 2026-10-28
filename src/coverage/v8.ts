// Reads what V8 says ran.
//
// Faultline takes V8's precise coverage after every call, and taking it resets the counters, so one
// reading is exactly what that call ran.
//
// V8 reports ranges over the file it executed, which is the transpiled copy. A code path is written
// in the file somebody wrote. Going from one to the other is what this module does.

import assert from "node:assert/strict";
import type { Session } from "node:inspector/promises";
import { TraceMap, generatedPositionFor } from "@jridgewell/trace-mapping";
import type { NotProvable, Paths, PathSite } from "./paths.ts";

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

// Starts V8 counting how often every block of every script runs.
//
// Precise coverage with call counts and block detail gives a count per block rather than a yes or no
// per function, and blocks are what a code path is read from. It has to start before the files it
// measures are loaded, because a function V8 compiled earlier carries no block counters.
export async function startCoverage(session: Session): Promise<void> {
    await session.post("Profiler.enable");
    await session.post("Profiler.startPreciseCoverage", {
        callCount: true,
        detailed: true,
        allowTriggeredUpdates: false,
    });
}

// Reads what V8 has counted since the last reading. Taking it resets every counter, so a reading
// taken after each call is exactly what that call ran.
export async function takeCoverage(session: Session): Promise<ScriptCoverage[]> {
    const taken = await session.post("Profiler.takePreciseCoverage");
    assert(Array.isArray(taken.result));
    return taken.result;
}

// One provable code path, with where its places ended up in the file that ran.
export interface MeasuredPath {
    // The path.
    path: PathSite;

    // Where the path's own place is in the file that ran.
    offset: number;

    // Where the place it is counted against is in the file that ran, when it has one.
    againstOffset?: number;
}

// One loaded file, with every code path in it found in the text that ran.
export interface MeasuredFile {
    // The URL V8 reports the loaded file under.
    url: string;

    // Every path some range can prove ran.
    paths: MeasuredPath[];

    // Every path no range can prove ran, left out of every count.
    notProvable: NotProvable[];
}

// Finds every code path of one file in the text that was loaded for it, once, so that reading what
// each call exercised costs a lookup per path and no source map work.
//
// A path whose place the transpile left nowhere, or whose place it is counted against was left
// nowhere, has no range that could prove it ran, so it joins the paths `pathsIn` already found no
// count for.
export function measureFile(url: string, loadedText: string, found: Paths): MeasuredFile {
    const mapText = inlineMapOf(loadedText);
    assert(mapText !== undefined, `the file loaded for ${url} carries no source map`);
    const places = new Places(mapText, loadedText);
    const paths: MeasuredPath[] = [];
    const notProvable: NotProvable[] = [...found.notProvable];
    for (const path of found.paths) {
        const offset = places.generatedOffsetOf(path.at.line, path.at.column);
        let againstOffset: number | undefined;
        if (path.against !== undefined) {
            againstOffset = places.generatedOffsetOf(path.against.line, path.against.column);
        }
        if (offset < 0 || againstOffset === -1) {
            notProvable.push({
                name: path.name,
                file: path.file,
                line: path.line,
                fn: path.fn,
                describe: path.describe,
            });
            continue;
        }
        paths.push({
            path,
            offset,
            againstOffset,
        });
    }
    assert.equal(paths.length + notProvable.length, found.paths.length + found.notProvable.length);
    return {
        url,
        paths,
        notProvable,
    };
}

// The code paths of one file that ran in one reading.
//
// A path with a place of its own ran when V8 counted that place as run. A path counted against
// another place ran when its own place ran more often than that one, which is how the side of an
// `if` with no `else` and the side an operator skipped are seen.
export function exercisedPaths(scripts: ScriptCoverage[], file: MeasuredFile): PathSite[] {
    const script = scripts.find((one) => one.url === file.url);
    if (script === undefined) {
        // A file V8 has nothing for did not run in this reading.
        return [];
    }
    const exercised: PathSite[] = [];
    for (const measured of file.paths) {
        const ran = countAt(script, measured.offset);
        if (measured.againstOffset === undefined) {
            if (ran > 0) {
                exercised.push(measured.path);
            }
            continue;
        }
        if (ran > countAt(script, measured.againstOffset)) {
            exercised.push(measured.path);
        }
    }
    assert(exercised.length <= file.paths.length);
    return exercised;
}
