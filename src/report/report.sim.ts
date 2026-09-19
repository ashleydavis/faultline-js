// Scenarios for the report a run prints.
//
// What it says turns on what the run found and on what stopped along the way, neither of which a
// made up value builds.

import type { Checklist, Injector } from "faultline";
import type { DriveResult } from "../drive/host.ts";
import type { RunModel } from "../model.ts";
import { report, type ReportInput } from "./report.ts";
import type { RunTally } from "./tally.ts";

// A run that found one file with one function in it.
function over(tally: RunTally, result: Partial<DriveResult>, model: Partial<RunModel> = {}): ReportInput {
    return {
        tally,
        took: 1234,
        reportFile: "/work/coverage-report.txt",
        found: 1,
        skipped: [{ file: "notes.md", because: "it is not source" }],
        all: false,
        model: {
            root: "/project",
            work: "/work",
            files: [],
            factories: [],
            scenarios: [],
            invariants: [],
            simModules: {},
            unseen: [],
            seeds: [1, 2],
            callBudget: 1000,
            ...model,
        },
        result: {
            scripts: new Map(),
            calls: new Map(),
            stepped: 0,
            hung: 0,
            died: 0,
            hungFunctions: new Set(),
            cannotBuild: new Map(),
            done: 1,
            rounds: 1,
            ...result,
        },
    };
}

// An empty tally, which is what a project with no function in it comes to.
const nothing: RunTally = { files: [], total: 0, ticked: 0, empty: ["quiet.ts"] };

// A run where nothing was stepped over, nothing hung and nothing ended the driver, which is the
// line the report leaves out.
export function aRunWhereNothingWentWrong(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const said = report(over(nothing, {})).lines.join("\n");
    if (said.includes("Stepped over")) {
        throw new Error("TheReportSaidSomethingWasSteppedOverWhenNothingWas");
    }
}

// A run where something was stepped over, something hung and something ended the driver.
export function aRunWhereThingsWentWrong(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const said = report(over(nothing, { stepped: 3, hung: 1, died: 2, rounds: 3 })).lines.join("\n");
    if (!said.includes("Stepped over")) {
        throw new Error("TheReportSaidNothingAboutWhatWasSteppedOver");
    }
}
