// Scenarios for putting together what the driving said.
//
// What these answer turns on a run and on what V8 counted over it, neither of which is a made up
// value.

import fs from "node:fs";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import type { Checklist, Injector } from "faultline";
import type { FileModel, RunModel } from "../model.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import { emitDriver } from "./browser.ts";
import { drive, driverBeside, startupBudget, tickedNames, unreachedFunctions, type DriveResult } from "./host.ts";
import type { Counts } from "../report/tally.ts";

// One function of the model.
function fn(label: string): FunctionInfo {
    return { label, file: "held.ts", line: 1, async: false, parameters: [], reach: { how: "export", name: label } };
}

// A run over one file with two functions, one path each.
const file: FileModel = {
    file: "held.ts",
    module: "/work/held.mjs",
    functions: [fn("ran"), fn("didNot")],
    classes: [],
    paths: [
        { name: "ran:entered", describe: "the body of ran", file: "held.ts", line: 1, fn: "ran", at: { line: 1, column: 0 } },
        { name: "didNot:entered", describe: "the body of didNot", file: "held.ts", line: 2, fn: "didNot", at: { line: 2, column: 0 } },
    ],
    tests: [],
    properties: [],
};

const model: RunModel = {
    root: "/project",
    work: "/work",
    files: [file],
    factories: [],
    scenarios: [],
    invariants: [],
    simModules: {},
    unseen: [],
    seeds: [1],
    callBudget: 1000,
};

// Counts saying the first path ran and the second did not.
const counts: Counts = { at: (_file, place) => (place.line === 1 ? 3 : 0) };

// What a run reached and what it has left, which is what the next round drives.
export function whatARunReachedAndWhatIsLeft(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const ticked = tickedNames(model, counts);
    if (!ticked.includes("held.ts:ran:entered")) {
        throw new Error("TheRunDidNotSayThePathThatRanHadRun");
    }
    if (ticked.includes("held.ts:didNot:entered")) {
        throw new Error("TheRunSaidAPathRanThatDidNot");
    }
    const left = unreachedFunctions(model, counts);
    if (!left.has("held.ts#didNot")) {
        throw new Error("TheRunDidNotSayWhichFunctionHasAPathLeft");
    }
    if (left.has("held.ts#ran")) {
        throw new Error("TheRunSaidAFunctionHasAPathLeftWhenItDoesNot");
    }
    // A run where everything ran, and one where nothing did.
    unreachedFunctions(model, { at: () => 1 });
    tickedNames(model, { at: () => 0 });
}

// How long the driver is allowed to load a project before it says anything, which is longer than
// one call is allowed.
export function howLongStartingUpIsAllowed(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (startupBudget(1000) <= 1000) {
        throw new Error("StartingUpWasAllowedNoLongerThanOneCall");
    }
    if (startupBudget(60000) !== 60000) {
        throw new Error("ABudgetLongerThanTheFloorWasShortened");
    }
}

// Puts a driver where this copy of the tool looks for one, and says where that is.
//
// The driver sits beside the module that starts it. A copy of the tool has no driver beside it, so
// one is written there, and the one written never runs: the module that forks is replaced while a
// run is measuring.
function driverWritten(): string {
    const where = fileURLToPath(new URL("./child.ts", import.meta.url));
    fs.writeFileSync(where, "");
    return where;
}

// Where the driver sits beside the tool, and what is said when it sits nowhere.
export function whereTheDriverSits(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const where = driverWritten();
    if (driverBeside() !== where) {
        throw new Error("TheDriverWasNotFoundWhereItWasPut");
    }

    fs.rmSync(where);
    let said = "";
    try {
        driverBeside();
    }
    catch (thrown) {
        said = (thrown as Error).message;
    }
    if (!said.includes("not found")) {
        throw new Error("ACopyWithNoDriverBesideItDidNotSaySo");
    }
}

// How many drivers one scenario listens to. Each one says something different, and a pass ends at
// the first thing its driver says that it knows what to do with, so a pass hears one of them. Two
// dozen is more than the number of things a driver has to say.
const driversHeardFrom = 96;

// One list of work driven from end to end, over a driver that answers the way a run makes up.
export async function oneListOfWorkDriven(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    driverWritten();
    let told = 0;
    // Driven again and again, because a driver says something different each time it is started and
    // one pass hears only what its own driver said before the pass ended.
    for (let at = 0; at < driversHeardFrom; at += 1) {
        const result = await drive(model, "/work/model.json", () => {
            told += 1;
        });
        if (result.rounds < 1) {
            throw new Error("TheDrivingCameBackHavingDrivenNoRound");
        }
    }
    void told;
}

// A driver that starts, says nothing and ends, which is what a module whose top level ends the
// process looks like from here. The unit it was on is stepped over and the rest still runs.
export async function aDriverThatSaysNothing(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    driverWritten();
    let died = 0;
    for (let at = 0; at < driversHeardFrom; at += 1) {
        injector.clear();
        // One per unit and one over, so every driver this pass starts is one that says nothing and
        // the list is worked through to the end rather than stopping at the first that speaks.
        for (let queued = 0; queued <= model.files[0]!.functions.length + 1; queued += 1) {
            injector.fail("process", "said-nothing");
        }
        died += (await drive(model, "/work/model.json", () => undefined)).died;
    }
    if (died === 0) {
        throw new Error("NoDriverEndedWithoutSayingAnything");
    }
}

// A driver that never ends, which is what a unit stuck in a loop looks like from here. It is
// stopped, the function it was on is named, and the run starts again at the unit after it.
export async function aDriverThatNeverEnds(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    driverWritten();
    let hung = 0;
    for (let at = 0; at < driversHeardFrom; at += 1) {
        injector.clear();
        for (let queued = 0; queued <= model.files[0]!.functions.length + 1; queued += 1) {
            injector.fail("process", "never-ends");
        }
        const result = await drive(model, "/work/model.json", () => undefined);
        hung += result.hung;
    }
    if (hung === 0) {
        throw new Error("NoDriverWasStoppedForNeverEnding");
    }
}

// A driver that ends with a status nobody checked, once saying why and once saying nothing about
// why.
export async function aDriverThatEndsBadly(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    driverWritten();
    for (const failure of ["failed", "failed-quietly"]) {
        injector.clear();
        for (let queued = 0; queued <= model.files[0]!.functions.length + 1; queued += 1) {
            injector.fail("process", failure);
        }
        const result = await drive(model, "/work/model.json", () => undefined);
        if (result.broke === undefined) {
            throw new Error("ADriverThatEndedBadlyWasNotReported");
        }
    }
}

// Queues enough failures of one kind that every driver a pass starts gets one.
function everyDriver(injector: Injector, failure: string): void {
    injector.clear();
    for (let queued = 0; queued <= model.files[0]!.functions.length + 1; queued += 1) {
        injector.fail("process", failure);
    }
}

// A run with no path to reach in it at all, which comes back after the one round.
export async function aRunWithNoPathToReach(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    driverWritten();
    everyDriver(injector, "said-nothing");
    const nothing: RunModel = { ...model, files: [{ ...file, paths: [] }] };
    const result = await drive(nothing, "/work/model.json", () => undefined);
    if (result.rounds !== 1) {
        throw new Error("ARunWithNoPathToReachDroveMoreThanOneRound");
    }
}

// A run whose only function is one written inside another, which no round after the first has
// anything to drive.
export async function aRunWithNothingToExplore(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    driverWritten();
    everyDriver(injector, "said-nothing");
    const inside: RunModel = {
        ...model,
        files: [
            {
                ...file,
                functions: [{ label: "inside", file: "held.ts", line: 1, async: false, parameters: [], within: "outer", reach: { how: "inside", because: "it is written inside another function, so only that function reaches it" } }],
                paths: [{ name: "inside:entered", describe: "the body of inside", file: "held.ts", line: 1, fn: "inside", at: { line: 1, column: 0 } }],
            },
        ],
    };
    const result = await drive(inside, "/work/model.json", () => undefined);
    if (result.rounds !== 1) {
        throw new Error("ARunWithNothingToExploreDroveMoreThanOneRound");
    }
}

// A driver that will not start at all, which is what a machine with no room for a process does.
export async function aDriverThatWillNotStart(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    driverWritten();
    injector.fail("process", "missing");
    const result = await drive(model, "/work/model.json", () => undefined);
    if (result.broke === undefined) {
        throw new Error("ADriverThatWouldNotStartWasNotReported");
    }
}

// One list of work driven in a page, with the page saying every kind of thing a page says.
//
// The driver the page loads is written here rather than being the tool's own: what is under test is
// the putting together of what a page said, not what a page does once it is driving.
async function drivenInAPage(root: string): Promise<DriveResult> {
    fs.writeFileSync(
        fileURLToPath(new URL("./page.ts", import.meta.url)),
        [
            "export async function driveInPage(model, units, ticked) {",
            "    void units; void ticked;",
            '    if (model.root === "/page-failed") {',
            '        return [{ type: "failed", seed: 1, where: "held.ts", error: "TheAnswerWasWrong", kind: "scenario" }];',
            "    }",
            '    if (model.root === "/page-broke") {',
            '        return [{ type: "broke", error: "TheModuleWouldNotLoad" }];',
            "    }",
            "    return [",
            '        { type: "unit", index: 0, calls: 1, stepped: 1, fn: "held.ts#greet", cannotBuild: { parameter: "a", typeText: "symbol" } },',
            '        { type: "unit", index: 1, calls: 1, stepped: 0, fn: "held.ts#greet", cannotBuild: { parameter: "a", typeText: "symbol" } },',
            '        { type: "unit", index: 2, calls: 1, stepped: 0, fn: "held.ts#greet" },',
            '        { type: "unit", index: 3, calls: 1, stepped: 0 },',
            '        { type: "finished" },',
            "    ];",
            "}",
            "",
        ].join("\n"),
    );

    const work = "/page-work";
    emitDriver(work, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
    fs.writeFileSync(`${work}/held.mjs`, "export function greet(name) {\n    return name.length;\n}\n");

    const inAPage: RunModel = {
        ...model,
        root,
        work,
        browser: { chromium: process.env.FAULTLINE_CHROMIUM },
    };
    // The page reads the run rather than being handed it, so what it reads is what is written here.
    fs.writeFileSync(`${work}/model.json`, JSON.stringify(inAPage));
    return await drive(inAPage, `${work}/model.json`, () => undefined);
}

// A page that drives the work and says how each unit went.
export async function aListOfWorkDrivenInAPage(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    await drivenInAPage("/page-ran");
}

// A page whose scenario says the answer is wrong, and one that could not run at all.
export async function aPageThatCameBackWithSomethingWrong(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    await drivenInAPage("/page-failed");
    await drivenInAPage("/page-broke");
}
