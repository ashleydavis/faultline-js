// Starts the process that does the driving, watches it, and puts back together what it says.
//
// A function with a loop that never ends would stop a run for good, so the driver is watched and
// stopped when it goes quiet, and started again at the unit after the one it was on.

import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { RunModel } from "../model.ts";
import { mergeInto, type Taken } from "../coverage/v8.ts";
import { countsFor, didRun, type Counts } from "../report/tally.ts";
import { driveInBrowser } from "./browser.ts";
import { functionKey, type FromDriver, type ScenarioFailed, type ToDriver, type Unit } from "./protocol.ts";
import { buildExploration, buildUnits } from "./units.ts";

// What the driving came back with.
export interface DriveResult {
    // What V8 reported for each copy the run loaded, kept apart by the process that counted it.
    scripts: Taken;

    // How many calls each function took, by the key of the file and its name.
    calls: Map<string, number>;

    // How many calls were stepped over because the code threw on an input it was never written
    // for.
    stepped: number;

    // How many units were stopped for running past the budget without returning.
    hung: number;

    // How many units ended the driver themselves, by loading a module whose top level ends the
    // process or by calling something that does.
    died: number;

    // The functions that were still running when the budget ran out, by the same key.
    hungFunctions: Set<string>;

    // The functions that could not be called at all, by the same key, with what each one needs.
    cannotBuild: Map<string, { parameter: string; typeText: string }>;

    // The scenario that said an answer was wrong, when one did.
    failure?: ScenarioFailed;

    // What stopped the driver, when something did.
    broke?: string;

    // How many units finished.
    done: number;

    // How many rounds were driven. The first calls everything, and each one after it drives only
    // the functions that still have a path nothing reached.
    rounds: number;
}

// Told as the driving goes, so a run can say how far along it is.
export type Progress = (done: number, total: number) => void;

// Drives the run. The list of work is built here from the same model the driver builds it from, so
// both sides number the units the same way.
export async function drive(model: RunModel, modelFile: string, onProgress: Progress): Promise<DriveResult> {
    const result: DriveResult = {
        scripts: new Map(),
        calls: new Map(),
        stepped: 0,
        hung: 0,
        died: 0,
        hungFunctions: new Set(),
        cannotBuild: new Map(),
        done: 0,
        rounds: 0,
    };

    let units = buildUnits(model);
    let seed = (model.seeds[model.seeds.length - 1] ?? 1) + 1;
    let ticked: string[] = [];

    // A round drives only the functions with a path left, and the rounds carry on until one of them
    // reaches no path the round before it had. There is no count of rounds: a project whose paths
    // keep falling stays worth another round, and one whose paths have stopped falling is done
    // whether that took two rounds or nine.
    for (let round = 1; ; round += 1) {
        const before = ticked.length;
        result.rounds = round;
        await driveList(model, modelFile, units, round === 1 ? undefined : units, ticked, result, onProgress);
        if (result.failure !== undefined || result.broke !== undefined) {
            return result;
        }
        const counts = countsFor(model, result.scripts);
        ticked = tickedNames(model, counts);
        const left = unreachedFunctions(model, counts);
        if (left.size === 0) {
            return result;
        }
        if (round > 1 && ticked.length === before) {
            return result;
        }
        const next = buildExploration(model, left, seed);
        seed += 1;
        if (next.length === 0) {
            return result;
        }
        units = next;
    }
}

// The path names a run has reached, so a scenario in a later round reads them off the checklist.
export function tickedNames(model: RunModel, counts: Counts): string[] {
    const out: string[] = [];
    for (const file of model.files) {
        for (const site of file.paths) {
            if (didRun(site, counts)) {
                out.push(`${site.file}:${site.name}`);
            }
        }
    }
    return out;
}

// The functions that still have a path nothing reached, by the key they are counted under.
export function unreachedFunctions(model: RunModel, counts: Counts): Set<string> {
    const left = new Set<string>();
    for (const file of model.files) {
        for (const site of file.paths) {
            if (!didRun(site, counts)) {
                left.add(functionKey(file.file, site.fn));
            }
        }
    }
    return left;
}

// Drives one list of work, starting the driver again after any unit that stopped it.
async function driveList(
    model: RunModel,
    modelFile: string,
    units: Unit[],
    given: Unit[] | undefined,
    ticked: string[],
    result: DriveResult,
    onProgress: Progress,
): Promise<void> {
    if (model.browser !== undefined) {
        await driveInPage(model, units, ticked, result, onProgress);
        return;
    }

    const total = units.length;
    let from = 0;
    // A restart costs the unit it was on, so a run whose units keep stopping the driver would
    // restart for ever. Twenty five is more than any real project needs, and every restart past it
    // would cost more time than the paths it could still reach are worth.
    const restartLimit = 25;

    for (let attempt = 0; attempt <= restartLimit; attempt += 1) {
        const ended = await runOnce(model, modelFile, from, given, ticked, result, total, onProgress);
        if (ended.how === "finished" || ended.how === "broke" || ended.how === "failed") {
            return;
        }
        if (ended.how === "hung") {
            result.hung += 1;
            const stuck = functionOf(model, units[ended.stoppedAt]);
            if (stuck !== undefined) {
                result.hungFunctions.add(stuck);
            }
        }
        else {
            result.died += 1;
        }
        from = ended.stoppedAt + 1;
        if (from >= total) {
            return;
        }
    }
}

// How long the driver is allowed to load the project's modules before it says anything. Thirty
// seconds is far longer than any project takes to load and short enough that a driver that will
// never start is still given up on.
export function startupBudget(callBudget: number): number {
    return Math.max(callBudget, 30000);
}

// Drives one list of work in a browser, which is one shot: a page is not started again part way
// through the way a process is.
async function driveInPage(
    model: RunModel,
    units: Unit[],
    ticked: string[],
    result: DriveResult,
    onProgress: Progress,
): Promise<void> {
    const generation = nextGeneration();
    const done = await driveInBrowser(model, units, ticked, model.browser?.chromium);
    if (done.broke !== undefined) {
        result.broke = done.broke;
        return;
    }
    mergeInto(result.scripts, generation, done.scripts);
    for (const message of done.said) {
        if (message.type === "unit") {
            result.stepped += message.stepped;
            result.done += 1;
            if (message.fn !== undefined) {
                result.calls.set(message.fn, (result.calls.get(message.fn) ?? 0) + message.calls);
                if (message.cannotBuild !== undefined && !result.cannotBuild.has(message.fn)) {
                    result.cannotBuild.set(message.fn, message.cannotBuild);
                }
            }
            onProgress(result.done, units.length);
            continue;
        }
        if (message.type === "failed") {
            result.failure = message;
            return;
        }
        if (message.type === "broke") {
            result.broke = message.error;
            return;
        }
    }
}

// Where the driver sits beside this file.
//
// A clone runs the tool's own TypeScript and an installed copy runs what the build emitted, because
// Node refuses to take the types out of a TypeScript file inside node_modules.
export function driverBeside(): string {
    for (const one of ["./child.js", "./child.ts"]) {
        const where = fileURLToPath(new URL(one, import.meta.url));
        if (fs.existsSync(where)) {
            return where;
        }
    }
    throw new Error("The driver was not found beside the tool. Run `npm run build` in a clone of it.");
}

// Numbers the processes a run starts, so what each one counted is kept apart from the rest.
let generations = 0;

// The number for the next process.
function nextGeneration(): number {
    generations += 1;
    return generations;
}

// Which function a unit was calling, for the line that says it never returned.
function functionOf(model: RunModel, unit: Unit | undefined): string | undefined {
    if (unit === undefined || unit.kind !== "call" || unit.file === undefined || unit.fn === undefined) {
        return undefined;
    }
    const file = model.files[unit.file];
    const held = file?.functions[unit.fn];
    if (file === undefined || held === undefined) {
        return undefined;
    }
    return functionKey(file.file, held.label);
}

// How one pass of the driver ended.
type Ending =
    | { how: "finished" }
    | { how: "broke" }
    | { how: "failed" }
    | { how: "hung"; stoppedAt: number }
    | { how: "died"; stoppedAt: number };

// Runs the driver once, from `from`, and says how it ended.
function runOnce(
    model: RunModel,
    modelFile: string,
    from: number,
    given: Unit[] | undefined,
    ticked: string[],
    result: DriveResult,
    total: number,
    onProgress: Progress,
): Promise<Ending> {
    return new Promise((settle) => {
        const generation = nextGeneration();
        const told: ToDriver = { model: modelFile, from, units: given, ticked };
        const child: ChildProcess = fork(driverBeside(), [JSON.stringify(told)], {
            cwd: model.work,
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            // The copies carry a map back to the source they were rewritten from, and this is what
            // makes the runtime read it, so an error names the line somebody wrote.
            execArgv: [...process.execArgv, "--enable-source-maps"],
        });

        let waitingOn = from;
        let timer: NodeJS.Timeout | undefined;
        let settled = false;
        let started = false;

        // Stops the run when the driver has said nothing for longer than it is allowed, which is
        // what a loop that never ends looks like from here.
        //
        // Starting up is allowed longer than a call, because it loads the project's own modules and
        // whatever they import, and a project that pulls in a compiler takes seconds to do it. That
        // is not a call running away, and counting it against the first unit's budget killed the
        // driver before it ever finished a unit.
        function watch(): void {
            clearTimeout(timer);
            timer = setTimeout(
                () => {
                    finish({ how: "hung", stoppedAt: waitingOn });
                },
                started ? model.callBudget : startupBudget(model.callBudget),
            );
        }

        // Settles once, whichever of the several ways this pass ends first.
        function finish(ending: Ending): void {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            child.kill("SIGKILL");
            settle(ending);
        }

        child.on("message", (raw) => {
            const message = raw as FromDriver;
            if (message.type === "ready") {
                started = true;
                watch();
                return;
            }
            if (message.type === "coverage") {
                mergeInto(result.scripts, generation, message.scripts);
                watch();
                return;
            }
            if (message.type === "unit") {
                waitingOn = message.index + 1;
                result.stepped += message.stepped;
                result.done += 1;
                if (message.fn !== undefined) {
                    result.calls.set(message.fn, (result.calls.get(message.fn) ?? 0) + message.calls);
                    if (message.cannotBuild !== undefined && !result.cannotBuild.has(message.fn)) {
                        result.cannotBuild.set(message.fn, message.cannotBuild);
                    }
                }
                onProgress(result.done, total);
                watch();
                return;
            }
            if (message.type === "failed") {
                result.failure = message;
                finish({ how: "failed" });
                return;
            }
            if (message.type === "broke") {
                result.broke = message.module === undefined ? message.error : `${message.module}: ${message.error}`;
                finish({ how: "broke" });
                return;
            }
            finish({ how: "finished" });
        });

        let saidOnError = "";
        child.stderr?.on("data", (chunk: Buffer) => {
            saidOnError += chunk.toString();
        });

        child.on("exit", (code) => {
            if (settled) {
                return;
            }
            if (waitingOn > from || code === 0) {
                // The driver ended without saying it had run out of work. A module whose top level
                // ends the process does this, and so does one that calls something that does, so
                // the unit it was on is stepped over and the rest of the list still runs.
                finish({ how: "died", stoppedAt: waitingOn });
                return;
            }
            result.broke = saidOnError.trim() === "" ? `The driver stopped with code ${code}.` : saidOnError.trim();
            finish({ how: "broke" });
        });

        child.on("error", (thrown) => {
            result.broke = thrown.message;
            finish({ how: "broke" });
        });

        watch();
    });
}
