// One run, from the walk to the report.

import fs from "node:fs";
import path from "node:path";
import { emit } from "./build/emit.ts";
import { emitDriver } from "./drive/browser.ts";
import { buildProgram, isModuleProject, stoppingErrors } from "./build/program.ts";
import { readFile } from "./discover/functions.ts";
import { literalsIn } from "./discover/literals.ts";
import { realNow } from "./effects/globals.ts";
import type { RecipeContext } from "./discover/recipes.ts";
import { simFileFor, walkSources } from "./discover/sources.ts";
import { drive } from "./drive/host.ts";
import { buildUnits } from "./drive/units.ts";
import { formatPlan, type FileModel, type RunModel } from "./model.ts";
import { seedsFor, type Options } from "./options.ts";
import { report, writeDetail } from "./report/report.ts";
import { tally } from "./report/tally.ts";

// Where the runtime module is declared, which is how a parameter of an effect type is told from a
// parameter whose type merely carries the same name.
const runtimeFile = [
    // A clone runs the source and resolves `faultline` through the package's exports, which name
    // what the build emitted, so both the source and the build are named here.
    "runtime/index.ts",
    "runtime/index.js",
    "runtime/index.d.ts",
    "../dist/runtime/index.js",
    "../dist/runtime/index.d.ts",
    "../src/runtime/index.ts",
].map((one) => path.resolve(fileDirectory(), one));

// What a run came to.
export interface RunResult {
    // What the process exits with.
    status: number;
}

// Prints one line.
export type Say = (text?: string) => void;

// Runs once.
export async function run(options: Options, say: Say, progress: Say): Promise<RunResult> {
    const startedAt = realNow();
    const root = options.root;

    const where = options.browser ? " in a browser" : "";
    say(`Fault testing the JavaScript and TypeScript in ${path.basename(root)}${where}.`);
    say();

    if (!isModuleProject(root)) {
        say("This project's package.json says its files are CommonJS, and flt loads modules.");
        say('Set "type": "module" in package.json, or point flt at a directory whose files are modules.');
        return { status: 1 };
    }

    const walked = walkSources({ root, source: options.source, exclude: options.exclude });
    const wanted = options.file === undefined ? walked.sources : walked.sources.filter((one) => one.file === options.file);
    if (wanted.length === 0) {
        if (options.file !== undefined) {
            say(`No source file called ${options.file} was found, so this run has no code to exercise.`);
            return { status: 1 };
        }
        say("The walk found no JavaScript or TypeScript file, so this run has no code to exercise.");
        return { status: 1 };
    }

    // Only the sim files sitting beside a file this run measures. A run narrowed to one file runs
    // that file's scenarios and no others, so narrowing never drags in a scenario for code the run
    // is not looking at.
    const wantedSims = new Map<string, string>();

    // The source file each sim file sits beside, which is the file its scenarios call into.
    const besideOf = new Map<string, string>();
    for (const one of wanted) {
        const beside = simFileFor(one.file);
        const found = walked.sims.get(beside);
        if (found !== undefined) {
            wantedSims.set(beside, found);
            besideOf.set(beside, one.file);
        }
    }
    const simFiles = [...wantedSims.values()];
    const built = buildProgram(root, [...wanted.map((one) => one.full), ...simFiles]);
    const broken = stoppingErrors(built.program, root);
    if (broken.length > 0) {
        say("The simulation would not compile. The compiler said:");
        say();
        for (const one of broken) {
            say(one);
        }
        return { status: 1 };
    }

    const context: RecipeContext = { checker: built.checker, runtimeFile, root };
    const measured = new Set(wanted.map((one) => one.file));
    const emitted = emit({ root, program: built.program, options: built.options, measured });

    const files: FileModel[] = [];
    const factories: RunModel["factories"] = [];
    const scenarios: RunModel["scenarios"] = [];
    const invariants: RunModel["invariants"] = [];
    const simModules: Record<string, string> = {};

    // What the run was narrowed to, whether by --function or by a plan naming one. A plan names it
    // as the file and the label together, because two files may each declare a function of one name.
    const onlyFn = options.replay?.fn ?? options.fn;

    for (const one of wanted) {
        // The program was built over exactly these files, so it holds each of them.
        const source = built.program.getSourceFile(one.full)!;
        const facts = readFile(context, source, one.file);
        const keeps = (label: string): boolean => {
            if (onlyFn === undefined) {
                return true;
            }
            return label === onlyFn || `${one.file}#${label}` === onlyFn;
        };
        const functions = facts.functions.filter((held) => keeps(held.label));
        const paths = (emitted.paths.get(one.file) ?? []).filter((site) => keeps(site.fn));
        const literals = literalsIn(context.checker, source);
        files.push({
            file: one.file,
            module: emitted.modules.get(one.file)!,
            sim: one.sim,
            functions,
            classes: facts.classes,
            paths,
            tests: literals.values,
            properties: literals.properties,
        });
    }

    for (const [simFile, full] of wantedSims) {
        // The program was built over the sim files as well, and each one was copied, so both are
        // there to be had.
        const source = built.program.getSourceFile(full)!;
        const where = emitted.modules.get(simFile)!;
        simModules[simFile] = where;
        const facts = readFile(context, source, simFile);
        factories.push(...facts.factories);
        for (const scenario of facts.scenarios) {
            scenarios.push({ ...scenario, module: where, beside: besideOf.get(simFile) });
        }
        for (const invariant of facts.invariants) {
            invariants.push({ ...invariant, module: where });
        }
    }

    const model: RunModel = {
        root,
        work: emitted.work,
        files,
        factories,
        scenarios,
        invariants,
        simModules,
        unseen: emitted.unseen,
        seeds: seedsFor(options),
        callBudget: options.budget,
        browser: options.browser ? { chromium: options.chromium } : undefined,
        replay: options.replay,
    };

    if (options.browser) {
        // The page loads the tool's own driver as well as the copies, so it goes into the work
        // directory beside them.
        emitDriver(emitted.work, built.options);
    }

    const modelFile = path.join(emitted.work, "model.json");
    fs.writeFileSync(modelFile, JSON.stringify(model));

    const functionCount = files.reduce((total, one) => total + one.functions.length, 0);
    const units = buildUnits(model);

    if (options.replay !== undefined) {
        const replayed = await drive(model, modelFile, () => {});
        const named = formatPlan(options.replay);
        if (replayed.failure !== undefined) {
            const what = replayed.failure.kind === "invariant" ? "stopped holding in" : "failed in";
            say(`The replay of "${named}" ${what} ${replayed.failure.where} with ${replayed.failure.error}.`);
            return { status: 1 };
        }
        if (replayed.broke !== undefined) {
            say(`The replay of "${named}" could not run: ${replayed.broke}`);
            return { status: 1 };
        }
        say(`The replay of "${named}" passed.`);
        return { status: 0 };
    }

    say("Deterministic simulation of 1 project. The report comes at the end.");
    say(`  Read ${wanted.length} source ${wanted.length === 1 ? "file" : "files"}, with ${functionCount} ${functionCount === 1 ? "function" : "functions"} to exercise.`);
    say(`  Exercising ${units.length} ${units.length === 1 ? "unit" : "units"}, scenarios first.`);

    const result = await drive(model, modelFile, (done, total) => {
        progress(`  Exercised ${done} of ${total} units.`);
    });

    say("  Reading what those calls reached.");

    if (result.broke !== undefined) {
        say();
        say("The simulation would not run. The runtime said:");
        say();
        say(result.broke);
        return { status: 1 };
    }

    if (result.failure !== undefined) {
        say();
        const what = result.failure.kind === "invariant" ? "stopped holding in" : "failed in";
        say(`Seed ${result.failure.seed} ${what} ${result.failure.where} with ${result.failure.error}.`);
        say(`Reproduce it with: flt --replay "${formatPlan({ seed: result.failure.seed })}"`);
        return { status: 1 };
    }

    const counted = tally(model, result);
    const reportFile = options.report ?? path.join(emitted.work, "coverage-report.txt");
    writeDetail(reportFile, counted);

    const verdict = report({
        model,
        result,
        tally: counted,
        found: walked.sources.length,
        skipped: walked.skipped,
        reportFile,
        took: realNow() - startedAt,
        all: options.all,
    });

    for (const line of verdict.lines) {
        say(line);
    }
    return { status: verdict.status };
}

// The directory this file is in. The runtime module is found relative to it.
function fileDirectory(): string {
    return path.dirname(new URL(import.meta.url).pathname);
}

// Reads the version out of the package's own manifest, so it is written in one place.
export function versionOf(): string {
    try {
        const manifest = path.resolve(fileDirectory(), "..", "package.json");
        const read = JSON.parse(fs.readFileSync(manifest, "utf8")) as { version?: string };
        return read.version ?? "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}
