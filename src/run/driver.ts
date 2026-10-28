//
// Splits a run into shards, one per source file and one per sim file, hands them to up to `jobs`
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
    jobs: number;
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
// The memory a run sets aside for each worker when it picks how many to start, in bytes. A
// worker's child holds the compiler's program for its shard and copies of the project's modules,
// and on 2026-10-21 the children of a run over a project of about 135 files held 0.8 to 1.4 GB
// each. Two gigabytes leaves room for that growth, so the workers a run starts by default fit in
// the memory the machine had free and a run never makes the machine swap until it stops answering.
//
export const workerMemoryBytes = 2 * 1024 * 1024 * 1024;

//
// How many workers a run starts when it is not told: one per core the machine offers this process,
// and no more than the free memory holds at `workerMemoryBytes` each, but always at least one.
//
export function defaultJobs(): number {
    return countJobs(os.availableParallelism(), os.freemem());
}

//
// The number of workers `cores` cores and `freeBytes` bytes of free memory hold: the smaller of the
// cores and the workers that fit in the memory, and at least one, because a run with no worker
// tests nothing.
//
export function countJobs(cores: number, freeBytes: number): number {
    assert(Number.isInteger(cores));
    assert(cores > 0);
    assert(freeBytes >= 0);
    const fitting = Math.floor(freeBytes / workerMemoryBytes);
    const jobs = Math.max(1, Math.min(cores, fitting));
    assert(jobs <= cores);
    assert(jobs >= 1);
    return jobs;
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
// Runs the shards of `options` with up to `jobs` workers, each made by `createWorker` and stopped
// when there is no shard left for it.
//
export async function runShards(options: IRunOptions, createWorker: () => IWorker): Promise<IRunResult> {
    assert(Number.isInteger(options.jobs));
    assert(options.jobs > 0);
    const shards = options.shards;
    const queue: IShardQueue = {
        shards,
        results: shards.map(() => undefined),
        next: 0,
        seed: options.seed,
    };
    const workers: Promise<void>[] = [];
    for (let count = 0; count < Math.min(options.jobs, shards.length); count += 1) {
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
