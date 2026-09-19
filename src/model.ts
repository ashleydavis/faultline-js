// What one run is, written as plain data.
//
// The process that reads the project and the process that drives it never share memory, so
// everything one tells the other is here and is written to the work directory as JSON.

import type { PathSite } from "./discover/paths.ts";
import type { ClassInfo, FactoryInfo, FunctionInfo, InvariantInfo, ScenarioInfo } from "./discover/functions.ts";

// One file a run measures, with everything read out of it.
export interface FileModel {
    // The path relative to the root of the run.
    file: string;

    // Where the rewritten copy of it was put.
    module: string;

    // The sim file beside it, when it has one.
    sim?: string;

    // The functions in it.
    functions: FunctionInfo[];

    // The classes in it.
    classes: ClassInfo[];

    // The code paths in it.
    paths: PathSite[];

    // The values this file's own comparisons test against. A value made up for a call to one of its
    // functions is drawn from these first, because a branch that turns on the content of an
    // argument is reached only by an argument holding what it looks for.
    tests: (string | number | boolean)[];

    // The property names this file reads off its values, so a stand-in answers those rather than
    // every name there is.
    properties: string[];
}

// The whole of what the driver is told.
export interface RunModel {
    // The directory the run started in.
    root: string;

    // The directory the rewritten copies were put in.
    work: string;

    // The files the run measures.
    files: FileModel[];

    // The test input factories every sim file holds, put together.
    factories: FactoryInfo[];

    // The scenarios every sim file holds, put together. `beside` is the source file the sim file
    // sits beside, which is the file the scenario calls into.
    scenarios: (ScenarioInfo & { module: string; beside?: string })[];

    // The invariants every sim file holds, put together. Each one is checked after every unit of
    // work, so a run says which call broke it rather than only that something did.
    invariants: (InvariantInfo & { module: string })[];

    // Where a scenario's own sim file was put, by the sim file's path.
    simModules: Record<string, string>;

    // The branches V8 reports no count for, which a run leaves out of its total and says so.
    unseen: import("./discover/paths.ts").Unseen[];

    // The seeds to sweep.
    seeds: number[];

    // How long one call may take before the run steps over it, in milliseconds.
    callBudget: number;

    // Where the code runs. A browser is what supplies a document, a window and the rest.
    browser?: { chromium?: string };

    // The one run to reproduce, when this run is a replay.
    replay?: Plan;
}

// Everything needed to reproduce one run.
export interface Plan {
    // The seed every value and every injected fault was drawn from.
    seed: number;

    // The function the plan drove, written as the file and the label, or left out to drive
    // everything the seed would have driven.
    fn?: string;
}

// Writes a plan the one way, so the text a run prints is the text a replay is given.
export function formatPlan(plan: Plan): string {
    if (plan.fn === undefined) {
        return `seed=${plan.seed}`;
    }
    return `seed=${plan.seed},fn=${plan.fn}`;
}

// Reads a plan back. It refuses anything it does not understand rather than driving something
// other than what was asked for.
export function parsePlan(text: string): Plan {
    let seed: number | undefined;
    let fn: string | undefined;
    for (const piece of text.split(",")) {
        const trimmed = piece.trim();
        if (trimmed === "") {
            continue;
        }
        const split = trimmed.indexOf("=");
        if (split < 0) {
            throw new Error(`The plan "${text}" has a part with no value: "${trimmed}".`);
        }
        const key = trimmed.slice(0, split);
        const value = trimmed.slice(split + 1);
        if (key === "seed") {
            const asNumber = Number(value);
            if (!Number.isInteger(asNumber)) {
                throw new Error(`The plan "${text}" names the seed "${value}", which is not a whole number.`);
            }
            seed = asNumber;
            continue;
        }
        if (key === "fn") {
            fn = value;
            continue;
        }
        throw new Error(`The plan "${text}" names "${key}", which a plan has no part called.`);
    }
    if (seed === undefined) {
        throw new Error(`The plan "${text}" names no seed, and a plan without one reproduces no run.`);
    }
    return { seed, fn };
}
