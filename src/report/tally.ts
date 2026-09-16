// Works out what ran, from the marks the driving reached and the paths the rewrite found.

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { countAcross, inlineMapOf, Places, type Taken } from "../coverage/v8.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import type { Place, PathSite } from "../discover/paths.ts";
import type { DriveResult } from "../drive/host.ts";
import { functionKey } from "../drive/protocol.ts";
import type { RunModel } from "../model.ts";

// One code path, and whether it ran.
export interface PathTally {
    // The path itself.
    site: PathSite;

    // Whether a call reached it.
    ticked: boolean;
}

// One function, and how much of it ran.
export interface FunctionTally {
    // The function itself.
    held: FunctionInfo;

    // Its paths, in the order they are written in the file.
    paths: PathTally[];

    // How many of those paths ran.
    ticked: number;

    // How many calls the function took.
    calls: number;

    // What the function needs before it can be called at all, when it needs something.
    needs?: { parameter: string; typeText: string };

    // Whether every call to it ran past the budget without returning.
    hung: boolean;
}

// One file, and how much of it ran.
export interface FileTally {
    // The file's path, relative to the root of the run.
    file: string;

    // Its functions, in the order they are written in the file.
    functions: FunctionTally[];

    // Whether every path in the file ran.
    complete: boolean;
}

// The whole of what a run found.
export interface RunTally {
    // The files, in the order they sort.
    files: FileTally[];

    // How many paths there are in total.
    total: number;

    // How many of them ran.
    ticked: number;

    // The files that declare no function, so there is no code in them to exercise.
    empty: string[];
}

// How often each place in each measured file ran.
export interface Counts {
    // How many times the code at this place ran.
    at: (file: string, place: Place) => number;
}

// Builds that from what V8 reported.
//
// V8 counts over the copy the run loaded. Each copy carries a map back to the file somebody wrote,
// so a place in your source becomes a place in the copy and then a count.
export function countsFor(model: RunModel, scripts: Taken): Counts {
    // One reader per file, built the first time that file is asked about, because parsing a map
    // costs more than every lookup against it put together.
    const readers = new Map<string, { places: Places; url: string } | undefined>();

    // The reader for one file, or nothing when the run never loaded it.
    function readerFor(file: string): { places: Places; url: string } | undefined {
        if (readers.has(file)) {
            return readers.get(file);
        }
        const held = model.files.find((one) => one.file === file);
        let built: { places: Places; url: string } | undefined;
        if (held !== undefined) {
            try {
                const text = fs.readFileSync(held.module, "utf8");
                const map = inlineMapOf(text);
                if (map !== undefined) {
                    built = { places: new Places(map, text), url: pathToFileURL(held.module).href };
                }
            }
            catch {
                // A copy the run has already cleaned up leaves its file unmeasured rather than
                // stopping the report on everything else.
                built = undefined;
            }
        }
        readers.set(file, built);
        return built;
    }

    return {
        at: (file, place) => {
            const reader = readerFor(file);
            if (reader === undefined) {
                return 0;
            }
            const offset = reader.places.generatedOffsetOf(place.line, place.column);
            if (offset < 0) {
                return 0;
            }
            return countAcross(scripts, reader.url, offset);
        },
    };
}

// Whether one path ran.
//
// A path with a place of its own ran when V8 counted that place as run. A path with a place to
// count against ran when its own place ran more often than the other, which is how the side of an
// `if` with no `else` and the short circuit of an operator are seen.
export function didRun(site: PathSite, counts: Counts): boolean {
    const ran = counts.at(site.file, site.at);
    if (site.against === undefined) {
        return ran > 0;
    }
    return ran > counts.at(site.file, site.against);
}

// Puts the marks and the paths together.
export function tally(model: RunModel, result: DriveResult): RunTally {
    return tallyWith(model, result, countsFor(model, result.scripts));
}

// Puts the counts and the paths together, over counts a caller already has.
export function tallyWith(model: RunModel, result: DriveResult, counts: Counts): RunTally {
    const files: FileTally[] = [];
    const empty: string[] = [];
    let total = 0;
    let ticked = 0;

    for (const file of model.files) {
        if (file.functions.length === 0) {
            empty.push(file.file);
            continue;
        }
        const byFunction = new Map<string, PathTally[]>();
        for (const site of file.paths) {
            const held = byFunction.get(site.fn);
            const entry: PathTally = { site, ticked: didRun(site, counts) };
            if (held === undefined) {
                byFunction.set(site.fn, [entry]);
                continue;
            }
            held.push(entry);
        }

        const functions: FunctionTally[] = [];
        for (const held of file.functions) {
            const key = functionKey(file.file, held.label);
            const paths = byFunction.get(held.label) ?? [];
            const ran = paths.filter((one) => one.ticked).length;
            total += paths.length;
            ticked += ran;
            functions.push({
                held,
                paths,
                ticked: ran,
                calls: result.calls.get(key) ?? 0,
                needs: result.cannotBuild.get(key),
                hung: result.hungFunctions.has(key),
            });
        }

        files.push({
            file: file.file,
            functions,
            complete: functions.every((one) => one.ticked === one.paths.length),
        });
    }

    return { files, total, ticked, empty };
}
