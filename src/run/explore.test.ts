//
// Checks which calls a shard is given. A scripted executor stands in for the child: it hands back
// the facts of a made-up shard and answers each token with the code paths, places and failures the
// test chose for it, and writes down every token in the order it was asked. So the order of calls,
// the one call per place per failure, the stop rule, the pass with values read from conditions, the
// scenarios and the merging of what was found are read straight off the tokens.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import type { IChoice } from "../values/choices.ts";
import type { Effect } from "../world/failures.ts";
import type { ReachedPlace } from "../world/injector.ts";
import { callsPerSpecMost, conditionSpecs, exploreShard, isCovered, record, withoutConditions, type IShardExecutor, type IShardProgress } from "./explore.ts";
import type { FailureKind, IFailure } from "./judge.ts";
import type { ICallResult, IFunctionPlan, IOpenRequest, IShardFacts } from "./messages.ts";

//
// A choice from a source with an index.
//
export function choice(source: IChoice["source"], index: number): IChoice {
    return {
        source,
        index,
    };
}

//
// A function to plan that Faultline can call.
//
export function plan(name: string, choices: IChoice[][], targets: string[]): IFunctionPlan {
    return {
        label: name,
        name,
        line: 1,
        uncallable: undefined,
        unbuildable: undefined,
        choices,
        targets,
    };
}

//
// A function to plan that Faultline cannot call, for the reason `because` gives.
//
export function uncallablePlan(name: string, because: string): IFunctionPlan {
    return {
        label: name,
        name,
        line: 1,
        uncallable: because,
        unbuildable: undefined,
        choices: [],
        targets: [],
    };
}

//
// A shard of `src/a.ts` with `functions` and `scenarios`.
//
export function shardOf(functions: IFunctionPlan[], scenarios: string[]): IShardFacts {
    return {
        file: "src/a.ts",
        functions,
        scenarios: scenarios.map((name, index) => ({
            name,
            line: index + 1,
        })),
        paths: [],
        notProvable: [],
        uncallable: [],
        simProblems: [],
        loadProblem: undefined,
    };
}

//
// The place a call reached at the `occurrence`-th call of `effect`, where `failures` could be
// injected.
//
export function reachedAt(effect: Effect, occurrence: number, failures: string[]): ReachedPlace {
    return {
        place: {
            effect,
            occurrence,
        },
        failures,
    };
}

//
// What a scripted call hands back.
//
export interface IScripted {
    //
    // The code paths it exercised.
    //
    exercised: string[];

    //
    // The places it reached.
    //
    reached: ReachedPlace[];

    //
    // The keys of the failures it found.
    //
    failures: string[];
}

//
// A call that exercised, reached and found nothing. Most scripted calls answer this, and the rest
// change one field of it.
//
export const noFindings: IScripted = {
    exercised: [],
    reached: [],
    failures: [],
};

//
// An executor that writes down every token it is asked to call.
//
export interface IScriptedExecutor extends IShardExecutor {
    //
    // Every token asked for, in order.
    //
    tokens: string[];

    //
    // The number of calls made before each reading, in order.
    //
    reads: number[];

    //
    // The code path keys the next reading gives.
    //
    unread: string[];
}

//
// An executor that opens `facts` and answers each token from `script`, writing down every token.
//
export function scripted(facts: IShardFacts, script: (token: string) => IScripted): IScriptedExecutor {
    const tokens: string[] = [];
    const reads: number[] = [];
    const unread: string[] = [];
    return {
        tokens,
        reads,
        unread,
        open: async () => facts,
        read: async (): Promise<string[]> => {
            reads.push(tokens.length);
            return unread.splice(0, unread.length);
        },
        call: async (token: string): Promise<ICallResult> => {
            tokens.push(token);
            const answer = script(token);
            return {
                token,
                exercised: answer.exercised,
                reached: answer.reached,
                injected: false,
                failures: answer.failures.map((key): IFailure => ({
                    kind: "crash",
                    message: key,
                    location: "",
                    key,
                    token,
                    stack: "",
                })),
                arguments: [],
            };
        },
    };
}

//
// The open request every test makes. Any whole seed would do, and every token the tests expect
// carries this one as `seed=9`, which shows the request's seed reached each call.
//
const request: IOpenRequest = {
    kind: "open",
    file: "src/a.ts",
    sims: [],
    seed: 9,
};

describe("exploreShard", () => {
    test("a shard's calls go function by function, then the condition calls, then the scenarios", async () => {
        const values = [[choice("boundary", 0), choice("condition", 0)]];
        const facts = shardOf([plan("f", values, ["never"]), plan("g", values, ["never"])], ["s", "t"]);
        const all = scripted(facts, () => noFindings);
        await exploreShard(all, request);
        assert.deepEqual(all.tokens, [
            "src/a.ts:f;seed=9;values=b0",
            "src/a.ts:g;seed=9;values=b0",
            "src/a.ts:f;seed=9;values=c0",
            "src/a.ts:g;seed=9;values=c0",
            "src/a.ts:s;seed=9",
            "src/a.ts:t;seed=9",
        ]);
    });

    test("each combination is called with no failure, then once per place per failure, places first reached after a failure included", async () => {
        const executor = scripted(shardOf([plan("f", [], ["never"])], []), (token) => {
            if (token.endsWith("seed=9")) {
                return {
                    ...noFindings,
                    reached: [
                        reachedAt("file-open", 0, ["file-not-found", "access-denied"]),
                        reachedAt("read", 0, ["input-or-output-error"]),
                    ],
                };
            }
            if (token.endsWith("fail=file-open#0/file-not-found")) {
                return {
                    ...noFindings,
                    reached: [
                        reachedAt("file-open", 0, ["file-not-found", "access-denied"]),
                        reachedAt("write", 0, ["out-of-space"]),
                    ],
                };
            }
            return noFindings;
        });
        const result = await exploreShard(executor, request);
        assert.deepEqual(executor.tokens, [
            "src/a.ts:f;seed=9",
            "src/a.ts:f;seed=9;fail=file-open#0/file-not-found",
            "src/a.ts:f;seed=9;fail=file-open#0/access-denied",
            "src/a.ts:f;seed=9;fail=read#0/input-or-output-error",
            "src/a.ts:f;seed=9;fail=write#0/out-of-space",
        ]);
        assert.deepEqual(result.tallies, [
            {
                name: "f",
                line: 1,
                calls: 5,
                cutShort: false,
            },
        ]);
    });

    test("what calls left for a later reading is read at the end of every function and scenario, and counts", async () => {
        const values = [[choice("boundary", 0), choice("condition", 0)]];
        const facts = shardOf([plan("f", values, ["f:read"]), plan("g", values, ["f:read"])], ["s"]);
        const all = scripted(facts, () => noFindings);
        all.unread.push("f:read");
        const result = await exploreShard(all, request);
        //
        // The reading after `f` gives the path `g` waits for, so `g` is not called and neither
        // function needs its condition calls.
        //
        assert.deepEqual(all.reads, [1, 1, 2]);
        assert.deepEqual(all.tokens, [
            "src/a.ts:f;seed=9;values=b0",
            "src/a.ts:s;seed=9",
        ]);
        assert.deepEqual(result.exercised, ["f:read"]);
    });

    test("a function stops being called once every path it waits for is exercised, by its own call or an earlier function's", async () => {
        const values = [[choice("boundary", 0), choice("boundary", 1), choice("boundary", 2)]];
        const executor = scripted(shardOf([plan("f", values, ["f:entered", "f:if"]), plan("g", values, ["f:if"])], []), (token) => {
            if (token.includes("values=b1")) {
                return {
                    ...noFindings,
                    exercised: ["f:entered", "f:if"],
                    reached: [reachedAt("clock", 0, ["time-stands-still"])],
                };
            }
            return {
                ...noFindings,
                exercised: ["f:entered"],
            };
        });
        const result = await exploreShard(executor, request);
        assert.deepEqual(executor.tokens, ["src/a.ts:f;seed=9;values=b0", "src/a.ts:f;seed=9;values=b1"]);
        assert.deepEqual(result.tallies.map((one) => one.calls), [2, 0]);
        assert.deepEqual(result.exercised, ["f:entered", "f:if"]);
    });

    test("values read from conditions are tried only after every function had the rest, and only for a function still missing a path", async () => {
        const values = [[choice("boundary", 0), choice("condition", 0)], [choice("boundary", 0)]];
        const executor = scripted(shardOf([plan("f", values, ["f:if"]), plan("g", values, ["g:entered"]), uncallablePlan("h", "it is written inside f")], []), (token) => {
            if (token.startsWith("src/a.ts:g")) {
                return {
                    ...noFindings,
                    exercised: ["g:entered"],
                };
            }
            if (token.includes("values=c0")) {
                return {
                    ...noFindings,
                    exercised: ["f:if"],
                };
            }
            return noFindings;
        });
        const result = await exploreShard(executor, request);
        assert.deepEqual(executor.tokens, ["src/a.ts:f;seed=9;values=b0,b0", "src/a.ts:g;seed=9;values=b0,b0", "src/a.ts:f;seed=9;values=c0,b0"]);
        assert.deepEqual(result.tallies.map((one) => [one.name, one.calls]), [["f", 2], ["g", 1], ["h", 0]]);
    });

    test("every scenario runs with no failure and then once per place per failure, with no early stop", async () => {
        const executor = scripted(shardOf([], ["first", "second"]), (token) => {
            if (token === "src/a.ts:first;seed=9") {
                return {
                    ...noFindings,
                    exercised: ["anything"],
                    reached: [reachedAt("environment", 0, ["variable-not-set"])],
                };
            }
            return noFindings;
        });
        const result = await exploreShard(executor, request);
        assert.deepEqual(executor.tokens, ["src/a.ts:first;seed=9", "src/a.ts:first;seed=9;fail=environment#0/variable-not-set", "src/a.ts:second;seed=9"]);
        assert.deepEqual(result.tallies.map((one) => [one.name, one.calls]), [["first", 2], ["second", 1]]);
    });

    test("a defect several calls found is kept once, as the first call found it", async () => {
        const executor = scripted(shardOf([plan("f", [[choice("boundary", 0), choice("boundary", 1)]], ["never"])], []), (token) => ({
            ...noFindings,
            failures: token.includes("b0") ? ["same", "first"] : ["same", "second"],
        }));
        const result = await exploreShard(executor, request);
        assert.deepEqual(result.failures.map((one) => [one.key, one.token]), [
            ["same", "src/a.ts:f;seed=9;values=b0"],
            ["first", "src/a.ts:f;seed=9;values=b0"],
            ["second", "src/a.ts:f;seed=9;values=b1"],
        ]);
    });

    test("a combination that keeps reaching new places is cut short at the limit and says so", async () => {
        let count = 0;
        const executor = scripted(shardOf([plan("f", [], ["never"])], []), () => {
            count += 1;
            return {
                ...noFindings,
                reached: [reachedAt("read", count, ["input-or-output-error"])],
            };
        });
        const result = await exploreShard(executor, request);
        assert.equal(executor.tokens.length, callsPerSpecMost);
        assert.deepEqual(result.tallies, [
            {
                name: "f",
                line: 1,
                calls: callsPerSpecMost,
                cutShort: true,
            },
        ]);
    });
});

//
// The failure the call of `failure.token` found, of `failure.kind` under `failure.key`.
//
export function failureOf(failure: { token: string; kind: FailureKind; key: string }): IFailure {
    return {
        kind: failure.kind,
        message: "m",
        location: "src/a.ts:2",
        key: failure.key,
        token: failure.token,
        stack: "",
    };
}

//
// A call of `token` made with the one value `value` that found `failures`.
//
export function callOf(token: string, value: string, failures: IFailure[]): ICallResult {
    return {
        token,
        exercised: [],
        reached: [],
        injected: false,
        failures,
        arguments: [value],
    };
}

describe("the parts", () => {
    test("a call's paths and failures are added to what the shard found", () => {
        const progress: IShardProgress = {
            exercised: new Set(["a"]),
            failures: new Map(),
            failedCalls: [],
        };
        record(progress, {
            token: "t",
            exercised: ["a", "b"],
            reached: [],
            injected: false,
            failures: [],
            arguments: [],
        });
        assert.deepEqual([...progress.exercised], ["a", "b"]);
        assert.equal(isCovered(progress, plan("f", [], ["a", "b"])), true);
        assert.equal(isCovered(progress, plan("f", [], ["a", "c"])), false);
    });

    test("a call that first finds a defect kept as a crash has its answer kept, and no other call does", () => {
        const progress: IShardProgress = {
            exercised: new Set(),
            failures: new Map(),
            failedCalls: [],
        };
        const crash = failureOf({
            token: "a",
            kind: "crash",
            key: "crash|one",
        });
        const hang = failureOf({
            token: "c",
            kind: "hang",
            key: "hang|one",
        });
        const uncaught = failureOf({
            token: "d",
            kind: "uncaught",
            key: "uncaught|one",
        });
        record(progress, callOf("a", "1", [crash]));
        record(progress, callOf("b", "2", [{
            ...crash,
            token: "b",
        }]));
        record(progress, callOf("c", "3", [hang]));
        record(progress, callOf("d", "4", [uncaught]));
        record(progress, callOf("e", "5", []));
        assert.deepEqual(progress.failedCalls, [{
            token: "a",
            failures: [crash],
            arguments: ["1"],
        }, {
            token: "d",
            failures: [uncaught],
            arguments: ["4"],
        }]);
        assert.deepEqual([...progress.failures.keys()], ["crash|one", "hang|one", "uncaught|one"]);
    });

    test("values read from conditions are held back, and the calls that change one parameter to one are listed on their own", () => {
        const lists = [[choice("boundary", 0), choice("condition", 0)], [choice("boundary", 0), choice("condition", 1)]];
        assert.deepEqual(withoutConditions(lists), [[choice("boundary", 0)], [choice("boundary", 0)]]);
        assert.deepEqual(conditionSpecs(lists), [
            [choice("condition", 0), choice("boundary", 0)],
            [choice("boundary", 0), choice("condition", 1)],
        ]);
        assert.deepEqual(conditionSpecs([[choice("boundary", 0)]]), []);
    });

    test("a shard whose facts put a function on line 0 is a defect", async () => {
        const facts: IShardFacts = {
            ...shardOf([], []),
            functions: [
                {
                    ...plan("f", [], []),
                    line: 0,
                },
            ],
        };
        await assert.rejects(exploreShard(scripted(facts, () => noFindings), request), /f starts on line 0, and lines count from 1\./);
    });
});
