//
// Decides which calls to make in one shard, from what each call turns out to exercise and reach.
//
// For each function Faultline can call, the top level first: its baseline values and each
// parameter's other boundary, seeded and factory values one at a time. Each is called once with no
// failure injected, then once per place per failure the calls reached, one failure per call, places
// first reached by a call with a failure injected included. Once every function has had those
// calls, each function with a code path still missed gets the same for each value read from its
// conditions, given to one parameter at a time. A function stops being called as soon as every
// code path it waits for has been exercised, by its own calls or any other. Then every scenario of
// a sim file runs the same way, once with no failure and once per place per failure, with no early
// stop.
//

import assert from "node:assert/strict";
import { generateSpecs, type IChoice, type Spec } from "../values/choices.ts";
import type { PlannedFailure } from "../world/injector.ts";
import { placeName } from "../world/places.ts";
import { isCrashKept } from "./crash-store.ts";
import type { ICallAnswer, IFailure } from "./judge.ts";
import type { ICallResult, IFunctionPlan, IOpenRequest, IShardFacts } from "./messages.ts";
import { writeToken } from "./token.ts";

//
// The most calls made for one combination of values. A function that reads a file in a loop
// reaches a new place for every chunk, and without a limit it would be called once for each. The
// limit is far above what a function with a few effects needs, and a function that reaches it is
// marked as cut short so the report says so.
//
export const callsPerSpecMost = 4096;

//
// What makes the calls of one shard.
//
export interface IShardExecutor {
    //
    // Opens the shard and says what is in it.
    //
    open(request: IOpenRequest): Promise<IShardFacts>;

    //
    // Makes one call, named by its replay token. What it exercised may be left for a later
    // reading.
    //
    call(token: string): Promise<ICallResult>;

    //
    // Reads what the calls whose counts were left for later exercised, as code path keys.
    //
    read(): Promise<string[]>;
}

//
// How many calls one function or scenario got.
//
export interface ITally {
    //
    // The function's label or the scenario's name.
    //
    name: string;

    //
    // The line it starts on.
    //
    line: number;

    //
    // How many calls were made.
    //
    calls: number;

    //
    // Whether some combination of values reached the limit on calls with places still untried.
    //
    cutShort: boolean;
}

//
// What one shard found.
//
export interface IShardResult {
    //
    // What the child read and loaded.
    //
    facts: IShardFacts;

    //
    // How many calls each function and each scenario got, in the order the facts list them.
    //
    tallies: ITally[];

    //
    // The keys of every code path the shard's calls exercised, in any file, sorted.
    //
    exercised: string[];

    //
    // Every failure found, each defect once, in the order first found.
    //
    failures: IFailure[];

    //
    // Each call that first found a defect a run keeps as a crash, in the order made, so a later run
    // answers the kept crash and shows its view without making the call again.
    //
    failedCalls: ICallAnswer[];
}

//
// What one shard's calls have found so far.
//
export interface IShardProgress {
    //
    // The keys of the code paths exercised.
    //
    exercised: Set<string>;

    //
    // The failures found, by key, in the order first found.
    //
    failures: Map<string, IFailure>;

    //
    // Each call that first found a defect a run keeps as a crash, in the order made.
    //
    failedCalls: ICallAnswer[];
}

//
// Opens a shard with `executor` and makes every call it needs.
//
export async function exploreShard(executor: IShardExecutor, request: IOpenRequest): Promise<IShardResult> {
    assert(Number.isInteger(request.seed));
    const facts = await executor.open(request);
    assert.equal(facts.file, request.file);
    const progress: IShardProgress = {
        exercised: new Set(),
        failures: new Map(),
        failedCalls: [],
    };
    const tallies: ITally[] = [];
    const callable: [IFunctionPlan, ITally][] = [];
    for (const plan of facts.functions) {
        assert(plan.line > 0, `${plan.label} starts on line ${plan.line}, and lines count from 1.`);
        const tally: ITally = {
            name: plan.label,
            line: plan.line,
            calls: 0,
            cutShort: false,
        };
        tallies.push(tally);
        if (plan.uncallable === undefined) {
            callable.push([plan, tally]);
        }
    }
    for (const [plan, tally] of callable) {
        await exploreFunction(executor, progress, request, plan, tally, generateSpecs(withoutConditions(plan.choices)));
    }
    for (const [plan, tally] of callable) {
        if (!isCovered(progress, plan)) {
            await exploreFunction(executor, progress, request, plan, tally, conditionSpecs(plan.choices));
        }
    }
    for (const scenario of facts.scenarios) {
        assert(scenario.line > 0, `${scenario.name} starts on line ${scenario.line}, and lines count from 1.`);
        const tally: ITally = {
            name: scenario.name,
            line: scenario.line,
            calls: 0,
            cutShort: false,
        };
        tallies.push(tally);
        await exploreSpec(executor, progress, tally, {
            file: request.file,
            name: scenario.name,
            seed: request.seed,
            values: [],
        }, () => false);
        await readLeft(executor, progress);
    }
    assert.equal(tallies.length, facts.functions.length + facts.scenarios.length);
    return {
        facts,
        tallies,
        exercised: [...progress.exercised].sort(),
        failures: [...progress.failures.values()],
        failedCalls: progress.failedCalls,
    };
}

//
// Makes the calls of one function for each of `specs`, stopping as soon as every code path it waits
// for is exercised.
//
export async function exploreFunction(
    executor: IShardExecutor,
    progress: IShardProgress,
    request: IOpenRequest,
    plan: IFunctionPlan,
    tally: ITally,
    specs: Spec[],
): Promise<void> {
    assert.equal(plan.uncallable, undefined, `${plan.label} cannot be called, so no call of it is made.`);
    assert.equal(tally.name, plan.label);
    for (const values of specs) {
        if (isCovered(progress, plan)) {
            break;
        }
        await exploreSpec(executor, progress, tally, {
            file: request.file,
            name: plan.name,
            seed: request.seed,
            values,
        }, () => isCovered(progress, plan));
    }
    await readLeft(executor, progress);
}

//
// Reads what the calls whose counts were left for later exercised, so the next function, and the
// shard's result, start from everything exercised so far.
//
export async function readLeft(executor: IShardExecutor, progress: IShardProgress): Promise<void> {
    const exercised = await executor.read();
    for (const key of exercised) {
        assert(key.length > 0, "A reading named a code path with an empty key.");
        progress.exercised.add(key);
    }
}

//
// The call one combination of values is made with, before a failure is chosen.
//
export interface ISpecCall {
    //
    // The file, relative to the project root.
    //
    file: string;

    //
    // The function's label or the scenario's name.
    //
    name: string;

    //
    // The run's seed.
    //
    seed: number;

    //
    // The value chosen for each parameter.
    //
    values: Spec;
}

//
// Makes the calls of one combination of values: once with no failure, then once per place per
// failure any of those calls reached, each failure at each place once. `isDone` is asked before
// every call, so a function stops the moment it needs no more.
//
export async function exploreSpec(executor: IShardExecutor, progress: IShardProgress, tally: ITally, spec: ISpecCall, isDone: () => boolean): Promise<void> {
    assert(Number.isInteger(spec.seed));
    assert(spec.file.length > 0);
    const queue: (PlannedFailure | undefined)[] = [undefined];
    const tried = new Set<string>();
    for (let next = 0; next < queue.length; next += 1) {
        if (isDone()) {
            return;
        }
        if (next >= callsPerSpecMost) {
            tally.cutShort = true;
            return;
        }
        const token = writeToken({
            ...spec,
            failure: queue[next],
        });
        const result = await executor.call(token);
        assert.equal(result.token, token);
        tally.calls += 1;
        record(progress, result);
        for (const reached of result.reached) {
            for (const failure of reached.failures) {
                const key = `${placeName(reached.place)}/${failure}`;
                if (tried.has(key)) {
                    continue;
                }
                tried.add(key);
                queue.push({
                    place: reached.place,
                    failure,
                });
            }
        }
        assert.equal(queue.length, tried.size + 1);
    }
}

//
// Adds what one call exercised and found to what the shard has found.
//
export function record(progress: IShardProgress, result: ICallResult): void {
    for (const key of result.exercised) {
        assert(key.length > 0, "A call exercised a code path with an empty key.");
        progress.exercised.add(key);
    }
    let isKept = false;
    for (const failure of result.failures) {
        assert(failure.key.length > 0, "A call found a failure with an empty key.");
        if (!progress.failures.has(failure.key)) {
            progress.failures.set(failure.key, failure);
            if (isCrashKept(failure)) {
                isKept = true;
            }
        }
    }
    if (isKept) {
        progress.failedCalls.push({
            token: result.token,
            failures: result.failures,
            arguments: result.arguments,
        });
    }
    assert(progress.failedCalls.length <= progress.failures.size);
}

//
// Whether every code path a function waits for has been exercised.
//
export function isCovered(progress: IShardProgress, plan: IFunctionPlan): boolean {
    return plan.targets.every((key) => progress.exercised.has(key));
}

//
// Each parameter's choices without the values read from conditions, which a function gets only
// after every function has had the rest.
//
export function withoutConditions(choices: IChoice[][]): IChoice[][] {
    const kept = choices.map((list) => list.filter((choice) => choice.source !== "condition"));
    assert.equal(kept.length, choices.length);
    return kept;
}

//
// The calls `generateSpecs` lists for a function's choices that carry a value read from a
// condition, each changing that one parameter from the baseline.
//
export function conditionSpecs(choices: IChoice[][]): Spec[] {
    if (!choices.some((list) => list.some((choice) => choice.source === "condition"))) {
        return [];
    }
    const specs = generateSpecs(choices).filter((spec) => spec.some((choice) => choice.source === "condition"));
    for (const spec of specs) {
        assert.equal(spec.length, choices.length);
        assert.equal(spec.filter((choice) => choice.source === "condition").length, 1);
    }
    return specs;
}
