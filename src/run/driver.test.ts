//
// Checks how a run is split and put back together: one shard per source file and per sim file in a
// fixed order, each shard's result read back in that order whatever the number of workers, every
// worker stopped, a code path counted only in the run's own source files and a defect two shards
// found kept once. Workers are stand-ins that answer from a script, and finish in an order that is
// not the shard order, so shard order is what the result shows.
//

import assert from "node:assert/strict";
import os from "node:os";
import { describe, test } from "@jest/globals";
import type { Walked } from "../discover/sources.ts";
import { coresLeftFree, countWorkers, defaultWorkers, listShards, mergeShards, runShards, workShards, type IShardQueue } from "./driver.ts";
import type { IShardResult } from "./explore.ts";
import { pathKey } from "./measure.ts";
import type { ICallResult, IOpenRequest, IShardFacts } from "./messages.ts";
import type { IWorker } from "./worker.ts";

//
// A walk that found two source files, the sim file beside one of them and a `global.sim.ts`, so a
// source file with a sim file of its own and one without are both listed.
//
const walked: Walked = {
    sources: [
        {
            file: "src/a.ts",
            full: "/project/src/a.ts",
            sim: "/project/src/a.sim.ts",
        },
        {
            file: "src/b.ts",
            full: "/project/src/b.ts",
        },
    ],
    sims: new Map([
        ["src/a.sim.ts", "/project/src/a.sim.ts"],
        ["global.sim.ts", "/project/global.sim.ts"],
    ]),
    globalSims: ["global.sim.ts"],
    skipped: [],
};

describe("listShards", () => {
    test("every source file comes first with the sim files it uses, then every sim file in the order its path sorts", () => {
        assert.deepEqual(listShards(walked), [
            {
                file: "src/a.ts",
                sims: ["src/a.sim.ts", "global.sim.ts"],
            },
            {
                file: "src/b.ts",
                sims: ["global.sim.ts"],
            },
            {
                file: "global.sim.ts",
                sims: ["global.sim.ts"],
            },
            {
                file: "src/a.sim.ts",
                sims: ["src/a.sim.ts"],
            },
        ]);
    });
});

//
// Gives the event loop `count` turns, so one worker's call can finish after another's without any
// test waiting on a timer.
//
export async function eventLoopTurns(count: number): Promise<void> {
    for (let turn = 0; turn < count; turn += 1) {
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
    }
}

//
// A worker that opens a shard with one function, calls it once and writes down what it did. Each
// call waits a little longer for files earlier in the order, so workers finish out of order.
//
export function scriptedWorker(log: string[]): IWorker {
    return {
        open: async (request: IOpenRequest): Promise<IShardFacts> => {
            log.push(`open ${request.file}`);
            return {
                file: request.file,
                functions: [{
                    label: "f",
                    name: "f",
                    line: 1,
                    uncallable: undefined,
                    unbuildable: undefined,
                    choices: [],
                    targets: ["never"],
                }],
                scenarios: [],
                paths: [],
                notProvable: [],
                uncallable: [],
                simProblems: [],
                loadProblem: undefined,
            };
        },
        read: async (): Promise<string[]> => [],
        call: async (token: string): Promise<ICallResult> => {
            const file = token.slice(0, token.indexOf(":"));
            await eventLoopTurns(file === "src/a.ts" ? 20 : 1);
            return {
                token,
                exercised: [pathKey("src/a.ts", "f:entered"), pathKey(file, "g:entered")],
                reached: [],
                injected: false,
                failures: [{
                    kind: "crash",
                    message: "m",
                    location: "",
                    key: "same",
                    token,
                    stack: "",
                }],
                arguments: [],
            };
        },
        stop: async () => {
            log.push("stop");
        },
    };
}

//
// The result of a shard of `file` that exercised `exercised` and found one defect, under the key
// every such result shares, written down with `token`.
//
export function shardResultOf(file: string, exercised: string[], token: string): IShardResult {
    return {
        facts: {
            file,
            functions: [],
            scenarios: [],
            paths: [],
            notProvable: [],
            uncallable: [],
            simProblems: [],
            loadProblem: undefined,
        },
        tallies: [],
        exercised,
        failures: [{
            kind: "hang",
            message: "m",
            location: "",
            key: "same",
            token,
            stack: "",
        }],
        failedCalls: [],
    };
}

describe("runShards", () => {
    test("the result is in shard order and the same for one worker and several, and every worker is stopped", async () => {
        const oneLog: string[] = [];
        const one = await runShards({
            walked,
            shards: listShards(walked),
            seed: 3,
            workers: 1,
        }, () => scriptedWorker(oneLog));
        const manyLog: string[] = [];
        const many = await runShards({
            walked,
            shards: listShards(walked),
            seed: 3,
            workers: 3,
        }, () => scriptedWorker(manyLog));
        assert.deepEqual(many, one);
        assert.deepEqual(one.shards.map((shard) => shard.facts.file), ["src/a.ts", "src/b.ts", "global.sim.ts", "src/a.sim.ts"]);
        assert.equal(oneLog.filter((line) => line === "stop").length, 1);
        assert.equal(manyLog.filter((line) => line === "stop").length, 3);
        assert.deepEqual(one.failures.map((failure) => failure.token), ["src/a.ts:f;seed=3"]);
    });

    test("no more workers start than there are shards", async () => {
        const log: string[] = [];
        await runShards({
            walked,
            shards: listShards(walked),
            seed: 3,
            workers: 16,
        }, () => scriptedWorker(log));
        assert.equal(log.filter((line) => line === "stop").length, 4);
    });

    test("a worker is stopped even when its shard fails", async () => {
        const log: string[] = [];
        const failing: IWorker = {
            ...scriptedWorker(log),
            open: () => Promise.reject(new Error("the worker broke")),
        };
        await assert.rejects(runShards({
            walked,
            shards: listShards(walked),
            seed: 3,
            workers: 1,
        }, () => failing), /the worker broke/);
        assert.deepEqual(log, ["stop"]);
    });
});

describe("runShards with fewer shards", () => {
    test("only the shards it is given are run, and none starts no worker", async () => {
        const log: string[] = [];
        const shards = listShards(walked);
        const ran = await runShards({
            walked,
            shards: [shards[1]!],
            seed: 3,
            workers: 4,
        }, () => scriptedWorker(log));
        assert.deepEqual(ran.shards.map((shard) => shard.facts.file), [shards[1]!.file]);
        assert.deepEqual(log.filter((line) => line.startsWith("open")), [`open ${shards[1]!.file}`]);
        const none: string[] = [];
        const empty = await runShards({
            walked,
            shards: [],
            seed: 3,
            workers: 4,
        }, () => scriptedWorker(none));
        assert.deepEqual(empty.shards, []);
        assert.deepEqual(none, []);
    });
});

describe("workShards", () => {
    test("one worker takes every shard left in the queue, writes each result at its shard's index and is stopped", async () => {
        const log: string[] = [];
        const shards = listShards(walked);
        const queue: IShardQueue = {
            shards,
            results: shards.map(() => undefined),
            next: 2,
            seed: 4,
        };
        await workShards(queue, scriptedWorker(log));
        assert.equal(queue.next, shards.length);
        assert.deepEqual(queue.results.map((result) => result?.facts.file), [undefined, undefined, "global.sim.ts", "src/a.sim.ts"]);
        assert.deepEqual(log, ["open global.sim.ts", "open src/a.sim.ts", "stop"]);
    });
});

describe("mergeShards", () => {
    test("a path counts only in the run's source files, and a defect two shards found is kept where it was first found", () => {
        const merged = mergeShards(walked, [
            shardResultOf("src/a.ts", [pathKey("src/b.ts", "g:entered"), pathKey("src/c.ts", "h:entered")], "first"),
            shardResultOf("src/b.ts", [pathKey("src/a.ts", "f:entered"), pathKey("src/b.ts", "g:entered")], "second"),
        ]);
        assert.deepEqual(merged.exercised, [pathKey("src/a.ts", "f:entered"), pathKey("src/b.ts", "g:entered")]);
        assert.deepEqual(merged.failures.map((failure) => failure.token), ["first"]);
        assert.equal(merged.shards.length, 2);
    });
});

describe("defaultWorkers", () => {
    test("the workers this machine's cores run, leaving two cores free", () => {
        assert.equal(defaultWorkers(), Math.max(1, os.availableParallelism() - 2));
    });
});

describe("countWorkers", () => {
    test("one worker per core less the two left free", () => {
        assert.equal(coresLeftFree, 2);
        assert.equal(countWorkers(14), 12);
        assert.equal(countWorkers(4), 2);
        assert.equal(countWorkers(3), 1);
    });

    test("one worker on a machine of one or two cores", () => {
        assert.equal(countWorkers(2), 1);
        assert.equal(countWorkers(1), 1);
    });

    test("cores that are not a whole number above zero are a programmer error", () => {
        assert.throws(() => countWorkers(0), assert.AssertionError);
        assert.throws(() => countWorkers(1.5), assert.AssertionError);
    });
});
