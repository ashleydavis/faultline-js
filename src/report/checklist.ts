// Turns what a run found into the list of things somebody has to do next.
//
// One line per thing, each carrying the file and the line, so the list is worked from the top
// without anything else having to be looked up.

import type { PathSite } from "../discover/paths.ts";
import type { FileTally, FunctionTally, RunTally } from "./tally.ts";

// One code path a run reported and no call reached.
export interface Missed {
    // The path itself.
    site: PathSite;

    // Why it was not reached, written to follow the path's name.
    because: string;
}

// The whole list.
export interface Checklist {
    // The paths no call reached, in the order they are written in the files.
    missed: Missed[];

    // What to do, one line each.
    todo: string[];
}

// Builds the list from what the run found.
export function checklistFor(tally: RunTally): Checklist {
    const missed: Missed[] = [];
    const todo: string[] = [];
    const needed: string[] = [];
    const unreachable: string[] = [];

    for (const file of tally.files) {
        for (const held of file.functions) {
            const want = needsSomething(file, held);
            if (want !== undefined) {
                // The paths of a function that cannot be called at all are left off the list:
                // writing what it asks for is the work, and every path follows from it.
                if (want.kind === "factory") {
                    needed.push(want.line);
                }
                else {
                    unreachable.push(want.line);
                }
                continue;
            }
            for (const path of held.paths) {
                if (path.ticked) {
                    continue;
                }
                missed.push({ site: path.site, because: "no call the run made up reached it" });
            }
        }
    }

    todo.push(...needed, ...unreachable);
    for (const one of missed) {
        todo.push(
            `Write a scenario reaching ${one.site.describe} at ${one.site.file}:${one.site.line} in ${one.site.fn}. No call the run made up got there.`,
        );
    }

    return { missed, todo };
}

// What one function needs before any of its paths can run, when it needs something.
function needsSomething(
    file: FileTally,
    held: FunctionTally,
): { kind: "factory" | "reach"; line: string } | undefined {
    if (held.hung && held.ticked < held.paths.length) {
        // Said whether or not some calls came back. A function that returns for one input and runs
        // for ever on another is still a function somebody has to go and change.
        return {
            kind: "reach",
            line: `${held.held.label} at ${file.file}:${held.held.line} ran past the budget without returning, so the run stopped it and the paths it was part way through were not counted. Write a scenario calling it with an input it returns for.`,
        };
    }
    if (held.calls > 0) {
        return undefined;
    }
    if (held.needs !== undefined) {
        return {
            kind: "factory",
            line: `Write a test input factory returning ${held.needs.typeText}, which ${held.held.label} takes as \`${held.needs.parameter}\`. Without one, ${held.held.label} at ${file.file}:${held.held.line} cannot be called at all.`,
        };
    }
    const reach = held.held.reach;
    if (reach.how === "method" && reach.classExport === "") {
        return {
            kind: "reach",
            line: `Export the class ${reach.className} at ${file.file}:${held.held.line} so ${held.held.label} can be called.`,
        };
    }
    if (held.ticked === held.paths.length) {
        // Something else called it and every path ran, so there is nothing to do about it.
        return undefined;
    }
    return undefined;
}

// The heading above the paths no call reached.
export function missedHeading(count: number): string {
    if (count === 1) {
        return "FAIL 1 code path that no call reached:";
    }
    return `FAIL ${count} code paths that no call reached:`;
}

// One missed path written out as the report prints it.
export function missedLine(one: Missed): string {
    return `${one.site.file}:${one.site.line} "${one.site.name}" in ${one.site.fn}: ${one.because}.`;
}
