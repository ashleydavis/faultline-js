//
// Repeats the call a replay token names and says how it went.
//
// Every call in a run gets copies of the project's modules of its own and a new instance of every
// value factory class, so a call goes the same way whatever calls came before it. A replay opens
// the token's shard in a new child and makes that one call, which gives the same answer on any
// machine for the same source. A kept crash is still tried after the code that crashed changes, as
// long as the function is still there and its values can still be built.
//

import assert from "node:assert/strict";
import path from "node:path";
import { isSimFile, type Walked } from "../discover/sources.ts";
import type { IFileSystem } from "../lib/file-system.ts";
import { writeCrashView } from "../report/crash-view.ts";
import { plural } from "../report/style.ts";
import { listShards } from "./driver.ts";
import { ownFrame, subjectOf, type ICallAnswer, type IFailure } from "./judge.ts";
import type { ICallResult, IOpenRequest, IShardFacts } from "./messages.ts";
import { readToken, writeToken, type IReplayToken } from "./token.ts";
import type { IWorker } from "./worker.ts";
import { isSameSpec } from "../values/choices.ts";

//
// A call that was replayed.
//
export interface IReplayMade {
    //
    // It was made.
    //
    ok: true;

    //
    // What it did.
    //
    value: ICallResult;
}

//
// A token whose call could not be made.
//
export interface IReplayRefused {
    //
    // It was not made.
    //
    ok: false;

    //
    // Why, as a sentence for the person who gave the token.
    //
    error: string;
}

//
// What replaying a token gives back.
//
export type ReplayResult = IReplayMade | IReplayRefused;

//
// Replays the call `text` names in the project `walked` describes, with a worker made by
// `createWorker` and stopped when the call has been made.
//
export async function replayCall(walked: Walked, text: string, createWorker: () => IWorker): Promise<ReplayResult> {
    const read = readToken(text);
    if (!read.ok) {
        return refused(read.error.message);
    }
    const call = read.value;
    const token = writeToken(call);
    assert(token.startsWith(`${call.file}:${call.name};`));
    const shard = listShards(walked).find((listed) => listed.file === call.file);
    if (shard === undefined) {
        return refused(`The token names ${call.file}, which is not a file Faultline tests in this project.`);
    }
    const request: IOpenRequest = {
        kind: "open",
        file: shard.file,
        sims: shard.sims,
        seed: call.seed,
    };
    const worker = createWorker();
    let facts: IShardFacts;
    let made: ICallResult | undefined;
    try {
        facts = await worker.open(request);
        assert.equal(facts.file, call.file);
        if (isCallable(facts, call.name)) {
            if (isBuildable(facts, call)) {
                made = await worker.call(token);
            }
        }
    }
    finally {
        await worker.stop();
    }
    if (!isCallable(facts, call.name)) {
        return refused(`The token names ${call.name} in ${call.file}, which Faultline cannot call there.`);
    }
    if (!made) {
        return refused(`The values the token names for ${call.name} in ${call.file} can no longer be built, because the function's parameters or the sim files changed since the token was written.`);
    }
    assert.equal(made.token, token);
    return {
        ok: true,
        value: made,
    };
}

//
// Whether every value a token names is one Faultline still offers the function: one per parameter,
// each a choice of that parameter. A scenario takes no values.
//
export function isBuildable(facts: IShardFacts, call: IReplayToken): boolean {
    assert.equal(facts.file, call.file);
    const plan = facts.functions.find((listed) => listed.name === call.name);
    if (plan === undefined) {
        return call.values.length === 0;
    }
    if (plan.choices.length !== call.values.length) {
        return false;
    }
    return call.values.every((value, position) => {
        const offered = plan.choices[position];
        assert(offered !== undefined);
        return offered.some((choice) => isSameSpec([choice], [value]));
    });
}

//
// Whether a shard has a function or a scenario a token can name that Faultline can call.
//
export function isCallable(facts: IShardFacts, name: string): boolean {
    assert(name.length > 0);
    const callable = facts.functions.filter((plan) => plan.uncallable === undefined);
    assert(callable.length <= facts.functions.length);
    if (callable.some((plan) => plan.name === name)) {
        return true;
    }
    return facts.scenarios.some((scenario) => scenario.name === name);
}

//
// A replay that could not be made, with the reason.
//
export function refused(error: string): IReplayRefused {
    assert(/^[A-Z]/.test(error), `${error} does not start as a sentence does.`);
    assert(error.endsWith("."));
    return {
        ok: false,
        error,
    };
}

//
// What a replay prints and what the process exits with.
//
export interface IReplayReport {
    //
    // The lines printed.
    //
    lines: string[];

    //
    // 0 when the call passed, 1 when it failed or could not be made.
    //
    exitCode: number;
}

//
// What a replay prints: the view of every failure the call found and a sentence saying how it went,
// or why the call could not be made. `sources` holds the text of the project files the failures
// happened in, by absolute path.
//
export function writeReplay(result: ReplayResult, projectRoot: string, sources: Map<string, string>): IReplayReport {
    assert(path.isAbsolute(projectRoot));
    assert([...sources.keys()].every((file) => path.isAbsolute(file)));
    if (!result.ok) {
        return {
            lines: [result.error],
            exitCode: 1,
        };
    }
    const call = readToken(result.value.token);
    assert(call.ok);
    const subject = subjectOf(isSimFile(call.value.file), call.value.name);
    const failures = result.value.failures;
    if (failures.length === 0) {
        return {
            lines: [`${subject} passed.`],
            exitCode: 0,
        };
    }
    const lines: string[] = [];
    for (const failure of failures) {
        lines.push(...writeCrashView({
            failure,
            arguments: result.value.arguments,
            projectRoot,
            readSource: (file: string) => sources.get(file),
            command: `npx flt --replay "${result.value.token}"`,
        }));
        lines.push("");
    }
    lines.push(`${subject} failed ${failures.length} ${plural(failures.length, "way", "ways")}.`);
    return {
        lines,
        exitCode: 1,
    };
}

//
// The text of every project file one of `failures` happened in, by absolute path, so the crash view
// can show the line. A file that has gone is left out, and its view shows no code and says
// everything else. A file that is there and cannot be read rejects with the error, because a view
// that quietly left its code out would hide what is wrong with the file.
//
export async function readFailureSources(files: IFileSystem, projectRoot: string, failures: IFailure[]): Promise<Map<string, string>> {
    assert(path.isAbsolute(projectRoot));
    const sources = new Map<string, string>();
    for (const failure of failures) {
        const frame = ownFrame(projectRoot, failure.stack);
        if (frame === undefined) {
            continue;
        }
        if (sources.has(frame.file)) {
            continue;
        }
        if (!await files.isFile(frame.file)) {
            continue;
        }
        sources.set(frame.file, await files.readText(frame.file));
    }
    assert(sources.size <= failures.length);
    return sources;
}

//
// What `runReplay` is given: the project, the token and where the worker and the lines come from
// and go to.
//
export interface IReplayRun {
    //
    // Where the project's files are read from.
    //
    files: IFileSystem;

    //
    // The absolute path of the project.
    //
    projectRoot: string;

    //
    // What the walk of the project found.
    //
    walked: Walked;

    //
    // The token, as it was typed.
    //
    text: string;

    //
    // Makes the worker the call is made in.
    //
    createWorker(): IWorker;

    //
    // Prints one line of what came of the replay.
    //
    print(line: string): void;
}

//
// Replays a token and prints what came of it, for `flt --replay "<token>"`. It hands back what the
// process exits with.
//
export async function runReplay(run: IReplayRun): Promise<number> {
    assert(path.isAbsolute(run.projectRoot));
    const result = await replayCall(run.walked, run.text, () => run.createWorker());
    const sources = result.ok ? await readFailureSources(run.files, run.projectRoot, result.value.failures) : new Map<string, string>();
    const report = writeReplay(result, run.projectRoot, sources);
    for (const line of report.lines) {
        run.print(line);
    }
    assert([0, 1].includes(report.exitCode));
    return report.exitCode;
}

//
// What replaying the kept crashes at the start of a run found.
//
export interface IKeptCrashes {
    //
    // The tokens that still name a call of the project, in the order kept, which stay in the file
    // whether or not their call still fails.
    //
    kept: string[];

    //
    // A sentence for each token that was dropped, saying which and why.
    //
    dropped: string[];

    //
    // The failures the kept crashes still have, which the run reports with its own.
    //
    failures: IFailure[];

    //
    // The answer of every kept token, replayed or read, in the order kept.
    //
    answers: ICallAnswer[];

    //
    // The kept tokens whose answer was read from the results cache, so their call was not made.
    //
    read: string[];
}

//
// How the kept crashes are replayed: by up to `workers` workers at once, each made with
// `createWorker`, with a progress line after each replay so a run never sits silent while they go.
//
export interface IKeptReplaying {
    //
    // The most replays made at once, the run's own number of workers, since each replay opens its
    // file in a worker of its own and the replays do not depend on one another.
    //
    workers: number;

    //
    // Makes the worker for one replay.
    //
    createWorker(): IWorker;

    //
    // Shows a progress line in place of the last.
    //
    showProgress(line: string): void;
}

//
// The replays still to make and the answers made so far, which every replaying worker shares.
//
export interface IReplayQueue {
    //
    // The tokens to replay, in the order kept.
    //
    tokens: string[];

    //
    // The position of the next token to hand out.
    //
    next: number;

    //
    // How many replays have finished.
    //
    done: number;

    //
    // The result of each replay that has finished, by token.
    //
    results: Map<string, ReplayResult>;
}

//
// Replays every kept crash before the run makes any call of its own, up to `replaying.workers` at
// once. A token with an answer in `known`, which holds the answers of shards whose key has not
// changed since, is answered from it without a replay, because the replay would give the same
// answer. A token that no longer names a call of the project is dropped.
//
export async function replayKeptCrashes(walked: Walked, tokens: string[], known: Map<string, ICallAnswer>, replaying: IKeptReplaying): Promise<IKeptCrashes> {
    assert(Number.isInteger(replaying.workers));
    assert(replaying.workers > 0);
    const queue: IReplayQueue = {
        tokens: [...new Set(tokens.filter((token) => !known.has(token)))],
        next: 0,
        done: 0,
        results: new Map(),
    };
    if (queue.tokens.length > 0) {
        replaying.showProgress(replayProgressLine(queue));
    }
    const replayers: Promise<void>[] = [];
    for (let count = 0; count < Math.min(replaying.workers, queue.tokens.length); count += 1) {
        replayers.push(replayFromQueue(walked, queue, replaying));
    }
    await Promise.all(replayers);
    assert.equal(queue.results.size, queue.tokens.length);
    const found: IKeptCrashes = {
        kept: [],
        dropped: [],
        failures: [],
        answers: [],
        read: [],
    };
    for (const token of tokens) {
        const answer = known.get(token);
        if (answer) {
            assert.equal(answer.token, token);
            found.kept.push(token);
            found.read.push(token);
            found.failures.push(...answer.failures);
            found.answers.push(answer);
            continue;
        }
        const result = queue.results.get(token);
        assert(result !== undefined);
        if (!result.ok) {
            found.dropped.push(`The kept crash ${token} was dropped: ${result.error}`);
            continue;
        }
        found.kept.push(token);
        found.failures.push(...result.value.failures);
        found.answers.push({
            token: result.value.token,
            failures: result.value.failures,
            arguments: result.value.arguments,
        });
    }
    assert.equal(found.kept.length + found.dropped.length, tokens.length);
    assert.equal(found.answers.length, found.kept.length);
    assert(found.dropped.every((line) => line.endsWith(".")));
    return found;
}

//
// Takes the next token from `queue` and replays it, until the queue is empty, showing progress after
// each. Several of these share one queue, so up to that many replays run at once.
//
export async function replayFromQueue(walked: Walked, queue: IReplayQueue, replaying: IKeptReplaying): Promise<void> {
    //
    // Each turn takes one token from the queue, so the loop ends.
    //
    while (queue.next < queue.tokens.length) {
        const token = queue.tokens[queue.next];
        assert(token !== undefined);
        queue.next += 1;
        queue.results.set(token, await replayCall(walked, token, () => replaying.createWorker()));
        queue.done += 1;
        replaying.showProgress(replayProgressLine(queue));
    }
    assert(queue.done <= queue.tokens.length);
}

//
// The progress line while kept crashes are replayed, such as "  Replaying kept crashes: 3 of 16
// done.", so a run that spends minutes on them says what it is doing.
//
export function replayProgressLine(queue: IReplayQueue): string {
    assert(queue.done <= queue.tokens.length);
    assert(queue.tokens.length > 0);
    return `  Replaying kept crashes: ${queue.done} of ${queue.tokens.length} done.`;
}

//
// The line a run prints about its kept crashes, such as "Replayed 1 kept crash, 1 still fails.", or
// "Read 2 kept crashes from the cache, 1 still fails." when no crash was replayed.
//
export function keptCrashesLine(kept: IKeptCrashes): string {
    const failing = new Set(kept.failures.map((failure) => failure.token)).size;
    const replayed = kept.kept.length - kept.read.length;
    assert(failing <= kept.kept.length);
    assert(replayed >= 0);
    const still = `${failing} still ${plural(failing, "fails", "fail")}`;
    if (kept.read.length === 0) {
        return `Replayed ${replayed} kept ${plural(replayed, "crash", "crashes")}, ${still}.`;
    }
    if (replayed === 0) {
        return `Read ${kept.read.length} kept ${plural(kept.read.length, "crash", "crashes")} from the cache, ${still}.`;
    }
    return `Replayed ${replayed} kept ${plural(replayed, "crash", "crashes")} and read ${kept.read.length} from the cache, ${still}.`;
}
