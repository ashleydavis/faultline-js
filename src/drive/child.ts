// The Node side of a run: it loads the copies, reads what V8 counted, and works through the list.
//
// The driving itself is in work.ts, which a run in a browser loads too. This is the part that only
// Node can do.

import fs from "node:fs";
import inspector from "node:inspector";
import { pathToFileURL } from "node:url";
import { addInto, type ScriptCoverage } from "../coverage/v8.ts";
import type { FileModel, RunModel } from "../model.ts";
import type { FromDriver, ToDriver, Unit } from "./protocol.ts";
import { buildUnits } from "./units.ts";
import type { CallableFactory } from "./values.ts";
import { describe, readFactories, runUnit, type Runtime } from "./work.ts";

// How often coverage is read and sent up. V8 counts from the moment coverage starts and never
// resets, so reading it late loses nothing except when this process is stopped for running past its
// budget. Two seconds bounds what such a stop throws away.
const sendEvery = 2000;

// The channel V8's own coverage comes back over.
const watcher = new inspector.Session();

// When coverage was last sent up.
let lastSent = 0;

// Starts V8 counting how often every range of every script runs.
function startWatching(): void {
    watcher.connect();
    watcher.post("Profiler.enable");
    // Precise coverage with call counts and block detail is what gives a count per block rather
    // than a yes or no per function, and blocks are what a code path is read from.
    watcher.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
}

// Everything this process has counted, added up across every reading.
const counted = new Map<string, ScriptCoverage>();

// Reads what V8 has counted since the last reading, adds it to the total, and hands back the total.
async function takeCoverage(work: string): Promise<ScriptCoverage[]> {
    addInto(counted, await readSinceLast(work));
    return [...counted.values()];
}

// Reads what V8 has counted since the last reading, keeping only the copies this run loaded.
function readSinceLast(work: string): Promise<ScriptCoverage[]> {
    return new Promise((settle) => {
        watcher.post("Profiler.takePreciseCoverage", (err, taken) => {
            if (err !== null || taken === undefined) {
                settle([]);
                return;
            }
            const inside = pathToFileURL(work).href;
            settle(taken.result.filter((script) => script.url.startsWith(inside)) as ScriptCoverage[]);
        });
    });
}

// Says one thing back to the process that started this one.
function say(message: FromDriver): void {
    process.send?.(message);
}

// What this runtime supplies to the driving.
function runtimeFor(model: RunModel, ticked: Set<string>): Runtime {
    return {
        load: async (file) => (await import(pathToFileURL(file).href)) as Record<string, unknown>,
        say,
        sendCoverage: async (force) => {
            const now = Date.now();
            if (!force && now - lastSent < sendEvery) {
                return;
            }
            lastSent = now;
            say({ type: "coverage", scripts: await takeCoverage(model.work) });
        },
        ticked,
    };
}

// Reads the model, then works through the list until it runs out or is stopped.
async function main(): Promise<void> {
    const told = JSON.parse(process.argv[2] ?? "{}") as ToDriver;
    const model = JSON.parse(fs.readFileSync(told.model, "utf8")) as RunModel;
    startWatching();
    const runtime = runtimeFor(model, new Set(told.ticked ?? []));

    let factories: CallableFactory[];
    try {
        factories = await readFactories(runtime, model);
    }
    catch (thrown) {
        say({ type: "broke", error: describe(thrown) });
        return;
    }

    say({ type: "ready" });

    const units = told.units ?? buildUnits(model);
    for (const unit of units) {
        if (unit.index < told.from) {
            continue;
        }
        try {
            if (!(await runUnit(runtime, model, unit, factories))) {
                return;
            }
        }
        catch (thrown) {
            await runtime.sendCoverage(true);
            say({ type: "broke", error: describe(thrown), module: moduleOf(model, unit) });
            return;
        }
    }
    await runtime.sendCoverage(true);
    say({ type: "finished" });
}

// Which file a unit was working on, for the message that says a module would not load.
function moduleOf(model: RunModel, unit: Unit): string | undefined {
    if (unit.kind === "call" && unit.file !== undefined) {
        return (model.files[unit.file] as FileModel | undefined)?.file;
    }
    if (unit.kind === "scenario" && unit.scenario !== undefined) {
        return model.scenarios[unit.scenario]?.file;
    }
    return undefined;
}

process.on("unhandledRejection", () => {
    // Code under test that leaves a promise rejected would take this process down with it, and the
    // run has more to drive after it.
});

await main();
