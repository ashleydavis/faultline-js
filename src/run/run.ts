//
// A fault testing run of a project: walks it, reads what the results cache still holds, replays the
// kept crashes it holds no answer for, runs every shard it holds no result for, keeps the results
// and the crashes, writes the report file and prints the report. It hands back what the process
// exits with.
//

import assert from "node:assert/strict";
import path from "node:path";
import { readSelection, walkSources, type Walked } from "../discover/sources.ts";
import { cacheDirectoryOf } from "../lib/cache-directory.ts";
import type { IFileSystem } from "../lib/file-system.ts";
import type { IOptions } from "../options.ts";
import { checklistItems, checklistLines, type IChecklistItem } from "../report/checklist.ts";
import { writeCrashView } from "../report/crash-view.ts";
import type { IOutput } from "../report/output.ts";
import { reportFileText } from "../report/report-file.ts";
import {
    cachedLines,
    coverageCounts,
    coverageLines,
    cutShortLines,
    exercisedLine,
    exitCodeOf,
    failureCountLines,
    firstFailureLines,
    fullReportLines,
    headerLine,
    problemLines,
    progressLine,
    readCountLines,
    reportPathLines,
    tookLine,
    type ICoverageCounts,
} from "../report/report.ts";
import { crashStorePath, crashTokens, isCrashKept, readCrashes, withNew, writeCrashes } from "./crash-store.ts";
import { listShards, mergeShards, runShards, type IShard } from "./driver.ts";
import type { IShardResult } from "./explore.ts";
import type { ICallAnswer, IFailure } from "./judge.ts";
import type { ICallResult, IOpenRequest, IShardFacts } from "./messages.ts";
import { keptCrashesLine, readFailureSources, replayCall, replayKeptCrashes, type IKeptCrashes } from "./replay.ts";
import {
    contributorsOf,
    keyOfShard,
    projectKeyInputs,
    readEntryFile,
    resultsDirectoryOf,
    saltOf,
    unitsToRun,
    writeEntryFile,
    type ICacheEntry,
    type IUnit,
} from "./results-cache.ts";
import { readToken } from "./token.ts";
import type { IWorker } from "./worker.ts";

//
// How often a terminal's progress line changes. Often enough that a run never looks stuck, and
// seldom enough that writing it costs nothing next to the calls it counts.
//
export const progressEveryMs = 500;

//
// What a command works with: the project, the tool and where its lines go. Everything that reaches
// outside the process comes in here, so a test stands in for each.
//
export interface IRunEnvironment {
    //
    // Where the project's files are read from and the cache is written to.
    //
    files: IFileSystem;

    //
    // The absolute path of the project.
    //
    projectRoot: string;

    //
    // The absolute path of the directory Faultline's own modules sit in, which the results cache
    // resolves imports with.
    //
    toolModules: string;

    //
    // Faultline's own version, which every key of the results cache holds.
    //
    faultlineVersion: string;

    //
    // The seed this run's values are drawn from.
    //
    seed: number;

    //
    // How many workers run at once when the command line does not say.
    //
    jobs: number;

    //
    // Where the lines go.
    //
    output: IOutput;

    //
    // Makes a worker for the project.
    //
    createWorker(): IWorker;

    //
    // The time now, in milliseconds, for the time a run took and its progress line.
    //
    now(): number;
}

//
// What the results cache decided for the shards of a run.
//
export interface ICachePlan {
    //
    // Whether the cache is used at all.
    //
    isUsed: boolean;

    //
    // Each shard's key, by its file. Empty when the cache is not used.
    //
    keys: Map<string, string>;

    //
    // Each shard's stored result that can be used as it is, in shard order, or undefined for a
    // shard that runs.
    //
    entries: (ICacheEntry | undefined)[];

    //
    // The kept answers of every shard whose stored result has the key the shard has now, whether or
    // not that result can be used as it is, by token. Empty when the cache is not used.
    //
    answers: Map<string, ICallAnswer>;
}

//
// Where a run has got to, for its progress line.
//
export interface IRunProgress {
    //
    // How many calls have been made.
    //
    calls: number;

    //
    // When the run started.
    //
    startedMs: number;

    //
    // When the progress line last changed.
    //
    shownMs: number;
}

//
// Runs Faultline over the project and prints the report. Hands back 0 when every code path was
// exercised and no call failed, and 1 otherwise or when the run could not start.
//
export async function runProject(environment: IRunEnvironment, options: IOptions): Promise<number> {
    assert.equal(options.command, "run");
    const root = environment.projectRoot;
    assert(path.isAbsolute(root));
    const output = environment.output;
    const startedMs = environment.now();
    output.print(headerLine(root));
    const selection = await readSelection(environment.files, root);
    if (!selection.ok) {
        output.printError(selection.error.message);
        return 1;
    }
    const walked = await walkSources(environment.files, {
        root,
        include: selection.value.include,
        exclude: selection.value.exclude,
    });
    const shards = selectedShards(listShards(walked), options.file);
    if (options.file) {
        if (shards.length === 0) {
            output.printError(`The option --file names ${options.file}, which is not a source file or sim file Faultline tests in this project.`);
            return 1;
        }
    }
    const kept = await readCrashes(environment.files, crashStorePath(root));
    if (!kept.ok) {
        output.printError(kept.error);
        return 1;
    }
    const plan = await planCache(environment, shards, isCacheUsed(options));
    const replayed = await replayKeptCrashes(walked, kept.value.filter((token) => isTokenSelected(options, token)), plan.answers, () => environment.createWorker());
    const progress: IRunProgress = {
        calls: 0,
        startedMs,
        shownMs: startedMs,
    };
    const ran = await runShards({
        walked,
        shards: shards.filter((_shard, position) => !plan.entries[position]),
        seed: environment.seed,
        jobs: options.jobs ?? environment.jobs,
    }, () => new RunWorker(environment, options.functionName, progress, environment.createWorker()));
    const results = joinResults(plan, ran.shards);
    if (options.functionName) {
        if (!hasSubject(results)) {
            output.printError(`The option --function names ${options.functionName}, which is no function or scenario Faultline found in ${options.file ?? "this project"}.`);
            return 1;
        }
    }
    const merged = mergeShards(walked, results);
    const failures = withKeptFailures({
        kept: replayed.failures,
        found: merged.failures,
    });
    await keepResults(environment, plan, results, replayed.answers);
    await writeCrashes(environment.files, crashStorePath(root), withNew([...kept.value.filter((token) => !isTokenSelected(options, token)), ...replayed.kept], crashTokens(failures)));
    const exercised = new Set(merged.exercised);
    const findings: IRunFindings = {
        walked,
        results,
        exercised,
        failures,
        items: checklistItems(results, exercised),
        cached: new Set(shards.filter((_shard, position) => plan.entries[position]).map((shard) => shard.file)),
        replayed,
        counts: coverageCounts(results, exercised),
    };
    const reportPath = options.report ?? path.relative(root, path.join(cacheDirectoryOf(root), "report.txt")).split(path.sep).join("/");
    await writeReportFile(environment, reportPath, findings);
    for (const line of await reportLines(environment, options, findings)) {
        output.print(line);
    }
    output.print(tookLine(environment.now() - startedMs));
    for (const line of reportPathLines(reportPath)) {
        output.print(line);
    }
    return exitCodeOf(findings.counts, failures, problemLines(results));
}

//
// What a run found, which the report and the report file are written from.
//
export interface IRunFindings {
    //
    // What the walk found.
    //
    walked: Walked;

    //
    // What every shard found, in shard order.
    //
    results: IShardResult[];

    //
    // The keys of every code path some call exercised.
    //
    exercised: Set<string>;

    //
    // Every failure, the kept crashes that still fail first, each defect once.
    //
    failures: IFailure[];

    //
    // Every thing to do.
    //
    items: IChecklistItem[];

    //
    // The files whose results came from the cache.
    //
    cached: Set<string>;

    //
    // What replaying the kept crashes found.
    //
    replayed: IKeptCrashes;

    //
    // What the code paths came to.
    //
    counts: ICoverageCounts;
}

//
// Writes the report file at `reportPath`, relative to the project root, making its directory.
//
export async function writeReportFile(environment: IRunEnvironment, reportPath: string, findings: IRunFindings): Promise<void> {
    assert(reportPath.length > 0);
    const reportFile = path.resolve(environment.projectRoot, reportPath);
    assert(path.isAbsolute(reportFile));
    await environment.files.makeDirectory(path.dirname(reportFile));
    await environment.files.writeText(reportFile, reportFileText({
        shards: findings.results,
        exercised: findings.exercised,
        failures: findings.failures,
        items: findings.items,
        skipped: findings.walked.skipped,
    }));
}

//
// The lines of the report from what was read to what was cached, in the order they are printed.
// The time taken and the report file's path come after them.
//
export async function reportLines(environment: IRunEnvironment, options: IOptions, findings: IRunFindings): Promise<string[]> {
    const results = findings.results;
    const lines = [...readCountLines(results), ...problemLines(results), ...findings.replayed.dropped.map((line) => `  ${line}`)];
    if (findings.replayed.kept.length > 0) {
        lines.push(`  ${keptCrashesLine(findings.replayed)}`);
    }
    if (options.fullReport) {
        lines.push(...fullReportLines(results, {
            exercised: findings.exercised,
            cached: findings.cached,
        }));
    }
    const first = findings.failures[0];
    if (first) {
        lines.push(...firstFailureLines(first, await failureView(environment, findings.walked, first, knownAnswers(findings))));
    }
    lines.push(...checklistLines(findings.items), ...cutShortLines(results), ...failureCountLines(findings.failures));
    lines.push(...coverageLines(findings.counts), exercisedLine(findings.counts), ...cachedLines(findings.cached));
    assert(lines.length > 0);
    return lines;
}

//
// The shards a run makes: every one, or with `--file` the one of that file and the shards of the
// sim files it uses.
//
export function selectedShards(shards: IShard[], file: string | undefined): IShard[] {
    if (!file) {
        return shards;
    }
    const named = shards.find((shard) => shard.file === file);
    if (!named) {
        return [];
    }
    //
    // The scenarios in the sim files a file uses exercise its code paths as its own calls do, so a
    // run narrowed to the file runs them too, and its coverage is the coverage a whole run gives
    // it. A sim file's own shard lists only itself, so narrowing to a sim file runs it alone.
    //
    const selected = shards.filter((shard) => shard === named || named.sims.includes(shard.file));
    assert(selected.includes(named));
    assert(selected.length <= 1 + named.sims.length);
    return selected;
}

//
// Whether the results cache is used: not with `--no-cache`, and not in a run narrowed with
// `--file` or `--function`, which makes fewer calls than a run of the whole project and so must
// neither load nor keep a whole file's result.
//
export function isCacheUsed(options: IOptions): boolean {
    assert.equal(options.command, "run");
    assert.equal(options.token, undefined);
    if (options.noCache) {
        return false;
    }
    if (options.file) {
        return false;
    }
    return !options.functionName;
}

//
// Whether `token` names a call of the shard of `file`.
//
export function isTokenOf(token: string, file: string): boolean {
    assert(file.length > 0);
    const read = readToken(token);
    assert(read.ok, `The answer of ${token} has a token Faultline did not write.`);
    return read.value.file === file;
}

//
// Whether a run narrowed with `--file` or `--function` takes the call `token` names, so it replays
// only the kept crashes in what it was narrowed to. A token that cannot be read is taken, so its
// replay says what is wrong with it.
//
export function isTokenSelected(options: IOptions, token: string): boolean {
    assert(token.length > 0);
    const read = readToken(token);
    if (!read.ok) {
        return true;
    }
    if (options.file) {
        if (read.value.file !== options.file) {
            return false;
        }
    }
    if (!options.functionName) {
        return true;
    }
    return isNamed({
        name: read.value.name,
        asked: options.functionName,
    });
}

//
// Whether a function or scenario named `names.name` in a token or a plan is the one `--function`
// asks for, `names.asked`. A second function with the same label (a getter and its setter) is
// named with its line after an `@`, and `--function` takes it by its label.
//
export function isNamed(names: { name: string; asked: string }): boolean {
    assert(names.asked.length > 0);
    assert(names.name.length > 0);
    if (names.name === names.asked) {
        return true;
    }
    return names.name.startsWith(`${names.asked}@`);
}

//
// What the results cache holds for `shards`: the key of each and the stored result of each that
// can be used as it is. With the cache not used every shard runs.
//
export async function planCache(environment: IRunEnvironment, shards: IShard[], isUsed: boolean): Promise<ICachePlan> {
    if (!isUsed) {
        return {
            isUsed,
            keys: new Map(),
            entries: shards.map(() => undefined),
            answers: new Map(),
        };
    }
    const root = environment.projectRoot;
    const salt = await saltOf(environment.files, root, environment.faultlineVersion);
    const inputs = projectKeyInputs(environment.files, {
        projectRoot: root,
        toolModules: environment.toolModules,
    }, salt);
    const keys = new Map<string, string>();
    const units: IUnit[] = [];
    for (const shard of shards) {
        const key = await keyOfShard(inputs, shard);
        keys.set(shard.file, key);
        units.push({
            file: shard.file,
            key,
            entry: await readEntryFile(environment.files, resultsDirectoryOf(root), shard.file),
        });
    }
    const toRun = unitsToRun(units);
    assert.equal(toRun.length, shards.length);
    return {
        isUsed,
        keys,
        entries: units.map((unit, position) => toRun[position] ? undefined : unit.entry),
        answers: answersByToken(units.flatMap((unit) => storedAnswers(unit))),
    };
}

//
// The answers the stored result of `unit` holds, the calls behind its kept crashes and the replays
// of its kept crashes, when it was made with the key the shard has now. A result made with another
// key holds answers the shard's code may no longer give.
//
export function storedAnswers(unit: IUnit): ICallAnswer[] {
    assert(unit.key.length > 0);
    if (!unit.entry) {
        return [];
    }
    assert.equal(unit.entry.file, unit.file);
    if (unit.entry.key !== unit.key) {
        return [];
    }
    return [...unit.entry.result.failedCalls, ...unit.entry.replays];
}

//
// `answers` by token. Two answers for one token are the same call made twice, so the later is
// kept.
//
export function answersByToken(answers: ICallAnswer[]): Map<string, ICallAnswer> {
    const byToken = new Map<string, ICallAnswer>();
    for (const answer of answers) {
        assert(answer.token.length > 0);
        byToken.set(answer.token, answer);
    }
    assert(byToken.size <= answers.length);
    return byToken;
}

//
// Every answer a run has for the view of its first failure: the kept crashes' and those of the
// calls behind the crashes each shard found, by token.
//
export function knownAnswers(findings: IRunFindings): Map<string, ICallAnswer> {
    const answers = [...findings.replayed.answers, ...findings.results.flatMap((result) => result.failedCalls)];
    assert(answers.every((answer) => answer.token.length > 0));
    const byToken = answersByToken(answers);
    assert(byToken.size <= answers.length);
    return byToken;
}

//
// The result of every shard in shard order: the stored one where the cache gave one, and the next
// result of the shards that ran everywhere else.
//
export function joinResults(plan: ICachePlan, ran: IShardResult[]): IShardResult[] {
    let next = 0;
    const results = plan.entries.map((entry) => {
        if (entry) {
            return entry.result;
        }
        const result = ran[next];
        assert(result, "A shard that was to run has no result.");
        next += 1;
        return result;
    });
    assert.equal(next, ran.length);
    return results;
}

//
// Stores the result of every shard, with the shards whose calls exercised its code paths in this
// run and the answers of its kept crashes, when the cache is used. Every shard's is written, the
// loaded ones too, because a shard that ran may now exercise code paths of one that did not.
//
export async function keepResults(environment: IRunEnvironment, plan: ICachePlan, results: IShardResult[], replays: ICallAnswer[]): Promise<void> {
    if (!plan.isUsed) {
        return;
    }
    assert.equal(plan.keys.size, results.length);
    const contributors = contributorsOf(results, plan.keys);
    const directory = resultsDirectoryOf(environment.projectRoot);
    for (const result of results) {
        const file = result.facts.file;
        const key = plan.keys.get(file);
        const contributing = contributors.get(file);
        assert(key, `${file} ran with no key.`);
        assert(contributing, `${file} has no contributors, and it contributes to itself.`);
        await writeEntryFile(environment.files, directory, {
            file,
            key,
            contributors: contributing,
            result,
            replays: replays.filter((answer) => isTokenOf(answer.token, file)),
        });
    }
}

//
// Whether a run narrowed with `--function` found what it names in any shard.
//
export function hasSubject(results: IShardResult[]): boolean {
    assert(Array.isArray(results));
    return results.some((result) => result.facts.functions.length > 0 || result.facts.scenarios.length > 0);
}

//
// The failures a run reports: the kept crashes that still fail first, because they were found
// before any call of this run, then the run's own, each defect once.
//
export function withKeptFailures(failures: { kept: IFailure[]; found: IFailure[] }): IFailure[] {
    const byKey = new Map<string, IFailure>();
    for (const failure of [...failures.kept, ...failures.found]) {
        if (!byKey.has(failure.key)) {
            byKey.set(failure.key, failure);
        }
    }
    assert(byKey.size <= failures.kept.length + failures.found.length);
    return [...byKey.values()];
}

//
// Whether the view of a failure shows the values its call was made with, from the call's answer or
// a replay of the call: a crash or an error no code caught, whose values the view shows. Replaying
// any other failure would cost a whole wall-clock limit for a call that never settles and show
// nothing more, and replaying a shard that failed to open would open it again for a view with no
// values to show.
//
export function isReplayedForView(failure: IFailure): boolean {
    assert(failure.token.length > 0);
    return isCrashKept(failure);
}

//
// The view of the first failure. A crash and an error no code caught show the values the call was
// made with: from the answer of its call in `answers` when the run has one, and otherwise from a
// replay of the call. Any other failure, and one the replay does not find again, is shown from what
// the run found.
//
export async function failureView(environment: IRunEnvironment, walked: Walked, failure: IFailure, answers: Map<string, ICallAnswer>): Promise<string[]> {
    const root = environment.projectRoot;
    assert(path.isAbsolute(root));
    let values: string[] = [];
    if (isReplayedForView(failure)) {
        const answer = answers.get(failure.token);
        if (answer) {
            if (answer.failures.some((again) => again.key === failure.key)) {
                values = answer.arguments;
            }
        }
        else {
            const result = await replayCall(walked, failure.token, () => environment.createWorker());
            if (result.ok) {
                if (result.value.failures.some((again) => again.key === failure.key)) {
                    values = result.value.arguments;
                }
            }
        }
    }
    const sources = await readFailureSources(environment.files, root, [failure]);
    return writeCrashView({
        failure,
        arguments: values,
        projectRoot: root,
        readSource: (file: string) => sources.get(file),
        command: "npx flt",
    });
}

//
// The facts of a shard as a run narrowed with `--function` sees them: only the function or
// scenario it names, and only that function's code paths, so the percentage covers only what was
// asked for. With no `--function` they are as the child gave them.
//
export function narrowFacts(facts: IShardFacts, functionName: string | undefined): IShardFacts {
    if (!functionName) {
        return facts;
    }
    const functions = facts.functions.filter((plan) => plan.label === functionName || isNamed({
        name: plan.name,
        asked: functionName,
    }));
    const labels = new Set(functions.map((plan) => plan.label));
    const narrowed: IShardFacts = {
        ...facts,
        functions,
        scenarios: facts.scenarios.filter((scenario) => scenario.name === functionName),
        paths: facts.paths.filter((record) => labels.has(record.fn)),
        notProvable: facts.notProvable.filter((notProvable) => labels.has(notProvable.fn)),
        uncallable: facts.uncallable.filter((uncallable) => uncallable.label === functionName),
    };
    assert(narrowed.paths.length <= facts.paths.length);
    return narrowed;
}

//
// The worker as a run uses it: each shard's facts narrowed to `--function`, and each call counted
// for the progress line, which changes at most every `progressEveryMs`.
//
export class RunWorker implements IWorker {
    //
    // What the run works with, for its clock and its output.
    //
    readonly environment: IRunEnvironment;

    //
    // The function `--function` names, or undefined for every function.
    //
    readonly functionName: string | undefined;

    //
    // Where the run has got to, shared by every worker of the run.
    //
    readonly progress: IRunProgress;

    //
    // The worker whose child makes the calls.
    //
    readonly worker: IWorker;

    //
    // Wraps `worker` for one run.
    //
    constructor(environment: IRunEnvironment, functionName: string | undefined, progress: IRunProgress, worker: IWorker) {
        assert(path.isAbsolute(environment.projectRoot));
        assert(progress.calls >= 0);
        this.environment = environment;
        this.functionName = functionName;
        this.progress = progress;
        this.worker = worker;
    }

    //
    // Opens a shard and narrows its facts to `--function`.
    //
    async open(request: IOpenRequest): Promise<IShardFacts> {
        const facts = await this.worker.open(request);
        assert.equal(facts.file, request.file);
        return narrowFacts(facts, this.functionName);
    }

    //
    // Makes a call and counts it.
    //
    async call(token: string): Promise<ICallResult> {
        const result = await this.worker.call(token);
        assert.equal(result.token, token);
        countCall(this.environment, this.progress, token);
        return result;
    }

    //
    // Reads what the calls left for later exercised.
    //
    read(): Promise<string[]> {
        return this.worker.read();
    }

    //
    // Ends the wrapped worker's child.
    //
    stop(): Promise<void> {
        return this.worker.stop();
    }
}

//
// Counts one call and, when the progress line is old enough, shows where the run has got to.
//
export function countCall(environment: IRunEnvironment, progress: IRunProgress, token: string): void {
    progress.calls += 1;
    const now = environment.now();
    assert(now >= progress.shownMs);
    if (now - progress.shownMs < progressEveryMs) {
        return;
    }
    progress.shownMs = now;
    const read = readToken(token);
    assert(read.ok, `The run made a call with a token it cannot read: ${token}`);
    environment.output.showProgress(progressLine({
        calls: progress.calls,
        elapsedMs: now - progress.startedMs,
        file: read.value.file,
        name: read.value.name,
    }));
}
