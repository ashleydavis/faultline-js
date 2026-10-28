//
// What `flt` does. It checks the runtime and then hands over to `main` in `cli.ts`, which does the
// work.
//
// The runtime is checked before the run starts, so a Node too old for Faultline gets the one
// sentence that says so. `flt.ts` passes in its own URL, the file system and the worker factory,
// so a test calls the same code with a file system in memory and children that answer from a
// script.
//

import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main as runFaultline } from "./cli.ts";
import type { IFileSystem } from "./lib/file-system.ts";
import { nodeVersionRefusal, readRequiredNode } from "./load/node-version.ts";
import { ConsoleOutput } from "./report/output.ts";
import { defaultWorkers } from "./run/driver.ts";
import type { IRunEnvironment } from "./run/run.ts";
import { largestSeed } from "./run/token.ts";
import { createWorker, defaultWorkerSettings, openLimitMs, type IWorker, type IWorkerFactory } from "./run/worker.ts";

//
// The directory Faultline's own modules sit in, from the URL of the entry file: `src` (run as
// TypeScript) in a clone and `dist` installed.
//
export function toolModulesOf(entryUrl: string): string {
    const here = fileURLToPath(entryUrl);
    const toolModules = path.resolve(path.dirname(here), "..");
    assert(path.isAbsolute(toolModules));
    assert(here.startsWith(toolModules));
    return toolModules;
}

//
// Makes a worker for the project at `places.projectRoot`, whose child runs `run/child-main` from the
// same directory as the modules of the entry file at `places.entryUrl`, and gives up on opening a
// file after `places.openLimitMs`.
//
export function createProjectWorker(factory: IWorkerFactory, places: { entryUrl: string; projectRoot: string; openLimitMs: number }): IWorker {
    const entryUrl = places.entryUrl;
    const projectRoot = places.projectRoot;
    assert(path.isAbsolute(projectRoot));
    const toolModules = toolModulesOf(entryUrl);
    const childEntry = path.join(toolModules, "run", `child-main${path.extname(fileURLToPath(entryUrl))}`);
    assert(childEntry.startsWith(toolModules));
    assert(places.openLimitMs > 0);
    return createWorker({
        ...defaultWorkerSettings(projectRoot, toolModules, childEntry),
        openLimitMs: places.openLimitMs,
    }, factory);
}

//
// How long a worker may take to open a file: `FAULTLINE_OPEN_LIMIT_MS` when it is set, so a test
// of a file that never finishes opening can wait a few seconds rather than the full limit, and
// `openLimitMs` otherwise. Undefined when the variable is set to anything but a whole number of
// milliseconds from 1 up.
//
export function readOpenLimitMs(variable: string | undefined): number | undefined {
    if (variable === undefined) {
        return openLimitMs;
    }
    if (!/^[1-9][0-9]*$/.test(variable)) {
        return undefined;
    }
    const limitMs = Number(variable);
    if (!Number.isSafeInteger(limitMs)) {
        return undefined;
    }
    assert(limitMs > 0);
    return limitMs;
}

//
// Faultline's own version, from its `package.json`, which every key of the results cache holds so
// a new Faultline never uses the results of another.
//
export async function readToolVersion(files: IFileSystem, packageFile: string): Promise<string> {
    const read: unknown = JSON.parse(await files.readText(packageFile));
    assert(typeof read === "object");
    assert(read);
    assert("version" in read);
    assert(typeof read.version === "string");
    assert(read.version.length > 0);
    return read.version;
}

//
// Everything a command works with in this process: the project in the current directory, the real
// file system, Faultline's version from its own `package.json`, workers whose children start from
// the entry file's modules, the process's own streams, the wall clock, a new seed and one worker per
// core.
//
export async function processEnvironment(entryUrl: string, files: IFileSystem, factory: IWorkerFactory, openLimitMs: number): Promise<IRunEnvironment> {
    const faultlineVersion = await readToolVersion(files, fileURLToPath(new URL("../../package.json", entryUrl)));
    const projectRoot = process.cwd();
    assert(path.isAbsolute(projectRoot));
    return {
        files,
        projectRoot,
        toolModules: toolModulesOf(entryUrl),
        faultlineVersion,
        seed: randomInt(0, largestSeed + 1),
        workers: defaultWorkers(),
        output: new ConsoleOutput({
            out: process.stdout,
            errors: process.stderr,
        }),
        createWorker: (): IWorker => createProjectWorker(factory, {
            entryUrl,
            projectRoot,
            openLimitMs,
        }),
        now: (): number => Date.now(),
    };
}

//
// Checks the runtime, then runs Faultline in the current directory with the arguments typed after
// `flt`, and sets what the process exits with.
//
export async function main(entryUrl: string, files: IFileSystem, factory: IWorkerFactory): Promise<void> {
    const packageFile = fileURLToPath(new URL("../../package.json", entryUrl));
    assert(path.isAbsolute(packageFile));
    assert.equal(path.basename(packageFile), "package.json");
    const versions = {
        node: process.versions.node,
        bun: process.versions["bun"],
    };
    const refusal = nodeVersionRefusal(versions, await readRequiredNode(files, packageFile));
    if (!refusal) {
        const limitMs = readOpenLimitMs(process.env["FAULTLINE_OPEN_LIMIT_MS"]);
        if (limitMs === undefined) {
            process.stderr.write(`FAULTLINE_OPEN_LIMIT_MS is "${process.env["FAULTLINE_OPEN_LIMIT_MS"]}", and it takes a whole number of milliseconds from 1 up.\n`);
            process.exitCode = 1;
            return;
        }
        const environment = await processEnvironment(entryUrl, files, factory, limitMs);
        process.exitCode = await runFaultline(process.argv.slice(2), environment);
    }
    else {
        process.stderr.write(`${refusal}\n`);
        process.exitCode = 1;
    }
}
