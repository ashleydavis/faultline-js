// The list of work one run does, built the same way on both sides so a restart lands on the unit
// it means to.

import type { RunModel } from "../model.ts";
import type { Unit } from "./protocol.ts";

// How many calls one unit makes. Four is used because a single call per seed leaves too much of a
// function's inputs untried, and more than a handful makes a unit long enough that a restart after
// a hang throws away work worth keeping.
export const callsPerUnit = 4;

// Builds the work for a later round: one unit per function that still has a path nothing reached.
export function buildExploration(model: RunModel, unreached: Set<string>, seed: number): Unit[] {
    const units: Unit[] = [];
    let index = 0;
    for (let file = 0; file < model.files.length; file += 1) {
        const held = model.files[file]!;
        for (let fn = 0; fn < held.functions.length; fn += 1) {
            if (held.functions[fn]!.reach.how === "inside") {
                continue;
            }
            if (!unreached.has(`${held.file}#${held.functions[fn]!.label}`)) {
                continue;
            }
            units.push({ index, kind: "explore", seed, faulting: false, file, fn });
            index += 1;
        }
    }
    return units;
}

// Builds the list of work. Scenarios come first, because a scenario is what somebody wrote to
// reach a path the run cannot reach on its own, and running them first means the report says what
// is left rather than what was never tried.
export function buildUnits(model: RunModel): Unit[] {
    const units: Unit[] = [];
    let index = 0;

    for (const seed of model.seeds) {
        for (let scenario = 0; scenario < model.scenarios.length; scenario += 1) {
            // A scenario never runs against effects that fail of their own accord. It says what to
            // call, and a run that broke the file system underneath it would report the scenario as
            // a wrong answer when nothing was wrong. A scenario that wants a failure asks the
            // injector for it by name.
            units.push({ index, kind: "scenario", seed, faulting: false, scenario });
            index += 1;
        }
    }

    for (const seed of model.seeds) {
        for (let file = 0; file < model.files.length; file += 1) {
            const held = model.files[file]!;
            for (let fn = 0; fn < held.functions.length; fn += 1) {
                if (held.functions[fn]!.reach.how === "inside") {
                    // A function the file does not export is reached by whatever calls it, so
                    // there is no unit that calls it directly.
                    continue;
                }
                units.push({ index, kind: "call", seed, faulting: isFaulting(model, seed), file, fn });
                index += 1;
            }
        }
    }

    return units;
}

// Whether this seed's calls run against effects that fail. The first seed does not, so a clean
// pass proves the code runs before anything is broken underneath it.
export function isFaulting(model: RunModel, seed: number): boolean {
    return seed !== model.seeds[0];
}
