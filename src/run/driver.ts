//
// Splits a run into shards, one per source file and one per sim file, hands them to up to `workers`
// workers and reads the results back in shard order, so the result does not depend on how many
// workers there were or which finished first.
//

import assert from "node:assert/strict";
import os from "node:os";
import { simFilesFor } from "../discover/sim.ts";
import { isSimFile, type Walked } from "../discover/sources.ts";
import { exploreShard, type IShardResult } from "./explore.ts";
import type { IFailure } from "./judge.ts";
import { fileOfPathKey } from "./measure.ts";
import type { IOpenRequest } from "./messages.ts";
import type { IWorker } from "./worker.ts";

//
// One shard of a run.
//
export interface IShard {
    //
    // The source file or sim file, relative to the project root.
    //
    file: string;

    //
    // The sim files its calls use, relative to the project root.
    //
    sims: string[];
}

//
// What a run is told.
//
export interface IRunOptions {
    //
    // What the walk found.
    //
    walked: Walked;

    //
    // The shards to run, in shard order: every shard of the walk, or the ones a narrowed run or the
    // results cache leaves.
    //
    shards: IShard[];

    //
    // The run's seed.
    //
    seed: number;

    //
    // The most workers that run at once.
    //
    workers: number;
}

//
// What a run found.
//
export interface IRunResult {
    //
    // What each shard found, in shard order.
    //
    shards: IShardResult[];

    //
    // The keys of every code path of the run's source files that some call exercised, sorted.
    //
    exercised: string[];

    //
    // Every failure found, each defect once, in shard order and then in the order found.
    //
    failures: IFailure[];
}

//
// The cores a default run leaves free, so the machine stays usable for whoever is at it while the
// workers take the rest.
//
export const coresLeftFree = 2;

//
// How many workers a run starts when it is not told: one per core the machine offers this process,
// less the cores it leaves free, but always at least one.
//
export function defaultWorkers(): number {
    return countWorkers(os.availableParallelism());
}

//
// The number of workers a machine of `cores` cores runs: the cores less `coresLeftFree`, and at
// least one, because a run with no worker tests nothing.
//
export function countWorkers(cores: number): number {
    assert(Number.isInteger(cores));
    assert(cores > 0);
    const workers = Math.max(1, cores - coresLeftFree);
    assert(workers <= cores);
    assert(workers >= 1);
    return workers;
}

//
// The shards of a run: every source file in the order the walk sorted them, then every sim file in
// the order its path sorts. A source file's calls use the sim file beside it and every
// `global.sim.ts`, and a sim file's scenarios use the sim file itself.
//
export function listShards(walked: Walked): IShard[] {
    assert(walked.sources.every((source) => !isSimFile(source.file)));
    const shards: IShard[] = walked.sources.map((source) => ({
        file: source.file,
        sims: simFilesFor(source, walked),
    }));
    for (const sim of [...walked.sims.keys()].sort()) {
        shards.push({
            file: sim,
            sims: [sim],
        });
    }
    assert.equal(shards.length, walked.sources.length + walked.sims.size);
    return shards;
}

//
// The shards of a run that the workers share, with the results they have read so far.
//
export interface IShardQueue {
    //
    // Every shard, in shard order.
    //
    shards: IShard[];

    //
    // What each shard found, at its shard's index, or undefined until a worker has run it.
    //
    results: (IShardResult | undefined)[];

    //
    // The index of the next shard no worker has taken.
    //
    next: number;

    //
    // The run's seed.
    //
    seed: number;
}

//
// Runs the shards of `options` with up to `options.workers` workers, each made by `createWorker` and stopped
// when there is no shard left for it.
//
export async function runShards(options: IRunOptions, createWorker: () => IWorker): Promise<IRunResult> {
    assert(Number.isInteger(options.workers));
    assert(options.workers > 0);
    const shards = options.shards;
    const queue: IShardQueue = {
        shards,
        results: shards.map(() => undefined),
        next: 0,
        seed: options.seed,
    };
    const workers: Promise<void>[] = [];
    for (let count = 0; count < Math.min(options.workers, shards.length); count += 1) {
        workers.push(workShards(queue, createWorker()));
    }
    await Promise.all(workers);
    assert.equal(queue.next, shards.length);
    const done = queue.results.map((result) => {
        assert(result !== undefined);
        return result;
    });
    return mergeShards(options.walked, done);
}

//
// Has one worker take shard after shard from `queue` until none is left, then stops it, whether or
// not its last shard failed, so no child process outlives the run.
//
export async function workShards(queue: IShardQueue, worker: IWorker): Promise<void> {
    assert.equal(queue.results.length, queue.shards.length);
    try {
        //
        // Each turn takes one shard, and there are finitely many, so the loop ends.
        //
        while (queue.next < queue.shards.length) {
            const index = queue.next;
            queue.next += 1;
            const shard = queue.shards[index];
            assert(shard !== undefined);
            assert.equal(queue.results[index], undefined);
            const request: IOpenRequest = {
                kind: "open",
                file: shard.file,
                sims: shard.sims,
                seed: queue.seed,
            };
            queue.results[index] = await exploreShard(worker, request);
        }
    }
    finally {
        await worker.stop();
    }
}

//
// The run's result from the shards' results, in shard order. A code path counts when it is in one
// of the run's source files, whichever shard's call exercised it, and a defect several shards found
// is kept once, where it was first found.
//
export function mergeShards(walked: Walked, shards: IShardResult[]): IRunResult {
    const sources = new Set(walked.sources.map((source) => source.file));
    const exercised = new Set<string>();
    const failures = new Map<string, IFailure>();
    for (const shard of shards) {
        for (const key of shard.exercised) {
            assert(key.length > 0, `The shard ${shard.facts.file} exercised a code path with an empty key.`);
            if (sources.has(fileOfPathKey(key))) {
                exercised.add(key);
            }
        }
        for (const failure of shard.failures) {
            assert(failure.key.length > 0, `The shard ${shard.facts.file} found a failure with an empty key.`);
            if (!failures.has(failure.key)) {
                failures.set(failure.key, failure);
            }
        }
    }
    return {
        shards,
        exercised: [...exercised].sort(),
        failures: [...failures.values()],
    };
}
