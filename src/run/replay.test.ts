//
// Checks replay. Goal: a replayed token opens its shard and makes that one call and no other, it
// gives the same answer as the call it repeats and a token that no longer names a call is refused
// with a sentence. Method: a stand-in worker whose one function crashes on one of its values,
// whatever calls came before, as every call Faultline makes is independent of the calls before it.
// The shard is run as a run would and its crash replayed, and the answers and the calls made are
// compared.
// The printing of a replay, the reading of the files the failures happened in (from a file system
// in memory), the kept crashes and their line are checked too.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import type { Walked } from "../discover/sources.ts";
import { createFakeFileSystem } from "../lib/fake-files.test.ts";
import { exploreShard } from "./explore.ts";
import type { ICallAnswer, IFailure } from "./judge.ts";
import type { ICallResult, IOpenRequest, IShardFacts } from "./messages.ts";
import { isBuildable, isCallable, keptCrashesLine, readFailureSources, refused, replayCall, replayFromQueue, replayKeptCrashes, replayProgressLine, runReplay, writeReplay, type IKeptReplaying, type IReplayQueue, type IReplayRun, type ReplayResult } from "./replay.ts";
import { readToken, type IReplayToken } from "./token.ts";
import type { IWorker } from "./worker.ts";

//
// A walk that found one source file.
//
const walked: Walked = {
    sources: [{
        file: "src/a.ts",
        full: "/project/src/a.ts",
    }],
    sims: new Map(),
    globalSims: [],
    skipped: [],
};

//
// What a stand-in worker did, for the test to read.
//
interface IWorkerLog {
    //
    // How many times a shard was opened.
    //
    opens: number;

    //
    // Every token it was asked to call.
    //
    calls: string[];

    //
    // How many times it was stopped.
    //
    stops: number;
}

//
// A stand-in worker over `src/a.ts`, whose one function `next` takes one parameter with five
// boundary values and waits for a path no call exercises, so a shard makes every call. The call
// with the third value crashes, whatever calls came before it. `uncallable` makes the function one
// Faultline cannot call.
//
export function crashingWorker(log: IWorkerLog, uncallable: string | undefined): IWorker {
    return {
        open: async (request: IOpenRequest): Promise<IShardFacts> => {
            log.opens += 1;
            return {
                file: request.file,
                functions: [{
                    label: "next",
                    name: "next",
                    line: 1,
                    uncallable,
                    unbuildable: undefined,
                    choices: [[0, 1, 2, 3, 4].map((index) => ({
                        source: "boundary",
                        index,
                    }))],
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
            log.calls.push(token);
            const value = token.split("values=")[1] ?? "";
            const failures: IFailure[] = [];
            if (value === "b2") {
                failures.push({
                    kind: "crash",
                    message: "The call to next crashed with b2.",
                    location: "src/a.ts:2",
                    key: "crash|TypeError|src/a.ts:2:5",
                    token,
                    stack: "TypeError: boom\n    at next (/project/src/a.ts:2:5)",
                });
            }
            return {
                token,
                exercised: [],
                reached: [],
                injected: false,
                failures,
                arguments: [value],
            };
        },
        stop: async () => {
            log.stops += 1;
        },
    };
}

//
// A log with nothing in it.
//
export function emptyLog(): IWorkerLog {
    return {
        opens: 0,
        calls: [],
        stops: 0,
    };
}

//
// The request a run opens `src/a.ts` with under `seed`.
//
export function requestOf(seed: number): IOpenRequest {
    return {
        kind: "open",
        file: "src/a.ts",
        sims: [],
        seed,
    };
}

describe("replayCall", () => {
    test("a replayed crash gives the answer the run's call gave, and the token's call is the only call made", async () => {
        const explored = await exploreShard(crashingWorker(emptyLog(), undefined), requestOf(7));
        assert.equal(explored.failures.length, 1);
        const crash = explored.failures[0];
        assert(crash);
        assert.equal(crash.token, "src/a.ts:next;seed=7;values=b2");
        const log = emptyLog();
        const replayed = await replayCall(walked, ` ${crash.token} `, () => crashingWorker(log, undefined));
        assert(replayed.ok);
        assert.deepEqual(replayed.value.failures, [crash]);
        assert.deepEqual(replayed.value.arguments, ["b2"]);
        assert.deepEqual(log.calls, [crash.token]);
        assert.equal(log.opens, 1);
        assert.equal(log.stops, 1);
    });

    test("a token with a failure injected makes that one call too", async () => {
        const log = emptyLog();
        const token = "src/a.ts:next;seed=7;values=b1;fail=read#0/short-read";
        const replayed = await replayCall(walked, token, () => crashingWorker(log, undefined));
        assert(replayed.ok);
        assert.equal(replayed.value.token, token);
        assert.deepEqual(log.calls, [token]);
        assert.equal(log.opens, 1);
        assert.equal(log.stops, 1);
    });

    test("a token that cannot be read, names no file of the run or no function Faultline can call is refused", async () => {
        const unread = await replayCall(walked, "nothing", () => crashingWorker(emptyLog(), undefined));
        assert.deepEqual(unread, refused("The token \"nothing\" does not start with the file and function it replays, written as <file>:<function>."));
        const elsewhere = await replayCall(walked, "src/z.ts:f;seed=1", () => crashingWorker(emptyLog(), undefined));
        assert.deepEqual(elsewhere, refused("The token names src/z.ts, which is not a file Faultline tests in this project."));
        const log = emptyLog();
        const missing = await replayCall(walked, "src/a.ts:gone;seed=1", () => crashingWorker(log, undefined));
        assert.deepEqual(missing, refused("The token names gone in src/a.ts, which Faultline cannot call there."));
        assert.deepEqual(log.calls, []);
        assert.equal(log.stops, 1);
        const blocked = await replayCall(walked, "src/a.ts:next;seed=1;values=b0", () => crashingWorker(emptyLog(), "it is written inside another function"));
        assert.deepEqual(blocked, refused("The token names next in src/a.ts, which Faultline cannot call there."));
    });

    test("a token whose values can no longer be built is refused", async () => {
        const log = emptyLog();
        const replayed = await replayCall(walked, "src/a.ts:next;seed=1;values=b9", () => crashingWorker(log, undefined));
        assert.deepEqual(replayed, refused("The values the token names for next in src/a.ts can no longer be built, because the function's parameters or the sim files changed since the token was written."));
        assert.deepEqual(log.calls, []);
        assert.equal(log.stops, 1);
    });
});

//
// The facts of a shard with one function `f` taking two parameters and one scenario `s`.
//
const facts: IShardFacts = {
    file: "src/a.ts",
    functions: [{
        label: "f",
        name: "f",
        line: 1,
        uncallable: undefined,
        unbuildable: undefined,
        choices: [
            [
                {
                    source: "boundary",
                    index: 0,
                },
            ],
            [
                {
                    source: "boundary",
                    index: 0,
                },
                {
                    source: "factory",
                    index: 1,
                },
            ],
        ],
        targets: [],
    }, {
        label: "g",
        name: "g",
        line: 5,
        uncallable: "it is written inside another function",
        unbuildable: undefined,
        choices: [],
        targets: [],
    }],
    scenarios: [{
        name: "s",
        line: 3,
    }],
    paths: [],
    notProvable: [],
    uncallable: [],
    simProblems: [],
    loadProblem: undefined,
};

//
// The call a token names, read.
//
export function callOf(token: string): IReplayToken {
    const read = readToken(token);
    assert(read.ok);
    return read.value;
}

describe("isCallable", () => {
    test("a function Faultline can call and a scenario are callable, and nothing else is", () => {
        assert.equal(isCallable(facts, "f"), true);
        assert.equal(isCallable(facts, "s"), true);
        assert.equal(isCallable(facts, "g"), false);
        assert.equal(isCallable(facts, "h"), false);
    });
});

describe("isBuildable", () => {
    test("values are buildable when there is one per parameter and each is one of its choices", () => {
        assert.equal(isBuildable(facts, callOf("src/a.ts:f;seed=1;values=b0,f1")), true);
        assert.equal(isBuildable(facts, callOf("src/a.ts:f;seed=1;values=b0,f0")), false);
        assert.equal(isBuildable(facts, callOf("src/a.ts:f;seed=1;values=b0")), false);
        assert.equal(isBuildable(facts, callOf("src/a.ts:s;seed=1")), true);
        assert.equal(isBuildable(facts, callOf("src/a.ts:s;seed=1;values=b0")), false);
    });

    test("a call of another shard is a defect in the replay", () => {
        assert.throws(() => isBuildable(facts, callOf("src/b.ts:f;seed=1;values=b0,f1")));
    });
});

describe("refused", () => {
    test("a refusal carries its sentence, and text that is not a sentence is refused", () => {
        assert.deepEqual(refused("No."), {
            ok: false,
            error: "No.",
        });
        assert.throws(() => refused("no."));
        assert.throws(() => refused("No"));
    });
});

//
// A result of the call `token` with `failures`.
//
export function resultOf(token: string, failures: IFailure[]): ICallResult {
    return {
        token,
        exercised: [],
        reached: [],
        injected: false,
        failures,
        arguments: ["1"],
    };
}

//
// A crash at line 2 of `file` found by `token`.
//
export function crashIn(file: string, token: string): IFailure {
    return {
        kind: "crash",
        message: "The call to f crashed with TypeError: pick is not a function.",
        location: "src/a.ts:2",
        key: "k",
        token,
        stack: `TypeError: pick is not a function\n    at f (${file}:2:5)`,
    };
}

//
// A replay that was made and gave `value`.
//
export function madeOf(value: ICallResult): ReplayResult {
    return {
        ok: true,
        value,
    };
}

//
// The replay of `text` in the project `walked` describes, with a crashing worker and no files,
// printing each line into `printed`.
//
export function replayRunOf(text: string, printed: string[]): IReplayRun {
    return {
        files: createFakeFileSystem({}),
        projectRoot: "/project",
        walked,
        text,
        createWorker: () => crashingWorker(emptyLog(), undefined),
        print(line: string): void {
            printed.push(line);
        },
    };
}

describe("writeReplay", () => {
    test("a refused token prints why and exits 1", () => {
        assert.deepEqual(writeReplay(refused("No."), "/project", new Map()), {
            lines: ["No."],
            exitCode: 1,
        });
    });

    test("a call that passed says so and exits 0", () => {
        assert.deepEqual(writeReplay(madeOf(resultOf("src/a.ts:f;seed=1", [])), "/project", new Map()), {
            lines: ["The call to f passed."],
            exitCode: 0,
        });
        assert.deepEqual(writeReplay(madeOf(resultOf("src/a.sim.ts:s;seed=1", [])), "/project", new Map()).lines, ["The scenario s passed."]);
    });

    test("a call that failed prints the view of each failure with the replay command and exits 1", () => {
        const token = "src/a.ts:f;seed=1;values=b0";
        const report = writeReplay(madeOf(resultOf(token, [crashIn("/project/src/a.ts", token)])), "/project", new Map([["/project/src/a.ts", "one\n    pick();\n"]]));
        assert.equal(report.exitCode, 1);
        assert.equal(report.lines[0]?.startsWith("-- CRASH src/a.ts:2:5 "), true);
        assert.equal(report.lines.includes("  2 |     pick();"), true);
        assert.equal(report.lines.includes(`    at npx flt --replay "${token}"`), true);
        assert.equal(report.lines.at(-1), "The call to f failed 1 way.");
        const twice = writeReplay(madeOf(resultOf(token, [crashIn("/project/src/a.ts", token), crashIn("/project/src/a.ts", token)])), "/project", new Map());
        assert.equal(twice.lines.at(-1), "The call to f failed 2 ways.");
    });

    test("a project root or a source that is not an absolute path is a defect in the replay", () => {
        assert.throws(() => writeReplay(refused("No."), "project", new Map()));
        assert.throws(() => writeReplay(refused("No."), "/project", new Map([["src/a.ts", "text"]])));
    });
});

describe("readFailureSources", () => {
    test("each project file a failure happened in is read once, and a file that has gone or names no frame is left out", async () => {
        const files = createFakeFileSystem({
            "/project/src/a.ts": "text",
        });
        const hang: IFailure = {
            ...crashIn("/project/src/a.ts", "t"),
            kind: "hang",
            stack: "",
        };
        const sources = await readFailureSources(files, "/project", [crashIn("/project/src/a.ts", "t"), crashIn("/project/src/a.ts", "u"), crashIn("/project/src/gone.ts", "v"), hang]);
        assert.deepEqual([...sources.entries()], [["/project/src/a.ts", "text"]]);
    });

    test("a file that is there and cannot be read rejects with the error", async () => {
        const files = createFakeFileSystem({
            "/project/src/locked.ts": "locked",
        });
        files.failNext("/project/src/locked.ts", "EACCES");
        await assert.rejects(readFailureSources(files, "/project", [crashIn("/project/src/locked.ts", "w")]), /EACCES/);
        assert.deepEqual(await readFailureSources(files, "/project", []), new Map());
    });
});

describe("runReplay", () => {
    test("the replay's lines are printed and its exit code handed back", async () => {
        const printed: string[] = [];
        assert.equal(await runReplay(replayRunOf("src/a.ts:next;seed=3;values=b0", printed)), 0);
        assert.deepEqual(printed, ["The call to next passed."]);
    });

    test("a refused token prints why and hands back 1", async () => {
        const printed: string[] = [];
        assert.equal(await runReplay(replayRunOf("bad", printed)), 1);
        assert.equal(printed.length, 1);
    });

    test("a call that crashed prints its view with the line it crashed on and hands back 1", async () => {
        const printed: string[] = [];
        const run: IReplayRun = {
            ...replayRunOf("src/a.ts:next;seed=7;values=b2", printed),
            files: createFakeFileSystem({
                "/project/src/a.ts": "export function next(value: string): void {\n    value.go();\n}\n",
            }),
        };
        assert.equal(await runReplay(run), 1);
        assert.equal(printed.includes("  2 |     value.go();"), true);
        assert.equal(printed.at(-1), "The call to next failed 1 way.");
    });
});

//
// The answer of a call of `token` that found one crash, made with the value `1`.
//
export function answerOf(token: string): ICallAnswer {
    return {
        token,
        failures: [{
            kind: "crash",
            message: "The call to next crashed.",
            location: "src/a.ts:2",
            key: "crash|src/a.ts:2",
            token,
            stack: "",
        }],
        arguments: ["1"],
    };
}

//
// Replaying with up to `workers` workers made by `createWorker`, keeping every progress line shown
// in `lines`.
//
export function replayingBy(createWorker: () => IWorker, workers: number, lines: string[]): IKeptReplaying {
    return {
        workers,
        createWorker,
        showProgress: (line: string): void => {
            lines.push(line);
        },
    };
}

//
// How many replays are open at once and the most there have been, for the test of replays made at
// the same time.
//
export interface IOpenCount {
    //
    // The replays open now.
    //
    now: number;

    //
    // The most open at any one time.
    //
    most: number;
}

//
// A worker that counts in `open` how many replays are open at once, and lets the other replays have
// a turn to start before it answers, so replays that run together are seen together.
//
export function overlappingWorker(open: IOpenCount): IWorker {
    const worker = crashingWorker(emptyLog(), undefined);
    return {
        ...worker,
        open: async (request: IOpenRequest): Promise<IShardFacts> => {
            open.now += 1;
            open.most = Math.max(open.most, open.now);
            await new Promise<void>((done) => {
                setImmediate(done);
            });
            const facts = await worker.open(request);
            open.now -= 1;
            return facts;
        },
    };
}

describe("replayKeptCrashes", () => {
    test("kept crashes are replayed by up to the run's workers at once, and answered in the order kept", async () => {
        const open: IOpenCount = {
            now: 0,
            most: 0,
        };
        const tokens = ["src/a.ts:next;seed=7;values=b2", "src/a.ts:next;seed=7;values=b0", "src/a.ts:next;seed=7;values=b1", "src/a.ts:next;seed=7;values=b3"];
        const kept = await replayKeptCrashes(walked, tokens, new Map(), replayingBy(() => overlappingWorker(open), 3, []));
        assert.equal(open.most, 3);
        assert.deepEqual(kept.kept, tokens);
        assert.deepEqual(kept.answers.map((answer) => answer.token), tokens);
    });

    test("a progress line is shown before the replays and after each one", async () => {
        const lines: string[] = [];
        await replayKeptCrashes(walked, ["src/a.ts:next;seed=7;values=b2", "src/a.ts:next;seed=7;values=b0"], new Map(), replayingBy(() => crashingWorker(emptyLog(), undefined), 2, lines));
        assert.deepEqual(lines, ["  Replaying kept crashes: 0 of 2 done.", "  Replaying kept crashes: 1 of 2 done.", "  Replaying kept crashes: 2 of 2 done."]);
    });

    test("with every kept crash answered from the cache no worker is made and no progress is shown", async () => {
        const token = "src/a.ts:next;seed=7;values=b2";
        const lines: string[] = [];
        const log = emptyLog();
        const kept = await replayKeptCrashes(walked, [token], new Map([[token, answerOf(token)]]), replayingBy(() => crashingWorker(log, undefined), 4, lines));
        assert.deepEqual(kept.read, [token]);
        assert.equal(log.opens, 0);
        assert.deepEqual(lines, []);
    });

    test("a token kept twice is replayed once and answered twice", async () => {
        const log = emptyLog();
        const token = "src/a.ts:next;seed=7;values=b2";
        const kept = await replayKeptCrashes(walked, [token, token], new Map(), replayingBy(() => crashingWorker(log, undefined), 2, []));
        assert.equal(log.opens, 1);
        assert.deepEqual(kept.kept, [token, token]);
    });

    test("no workers is a programmer error", async () => {
        await assert.rejects(replayKeptCrashes(walked, [], new Map(), replayingBy(() => crashingWorker(emptyLog(), undefined), 0, [])), assert.AssertionError);
    });

    test("kept crashes that still name a call stay, and those that do not are dropped with a sentence", async () => {
        const kept = await replayKeptCrashes(walked, ["src/a.ts:next;seed=7;values=b2", "src/a.ts:next;seed=7;values=b0", "src/gone.ts:f;seed=1"], new Map(), replayingBy(() => crashingWorker(emptyLog(), undefined), 1, []));
        assert.deepEqual(kept.kept, ["src/a.ts:next;seed=7;values=b2", "src/a.ts:next;seed=7;values=b0"]);
        assert.deepEqual(kept.dropped, ["The kept crash src/gone.ts:f;seed=1 was dropped: The token names src/gone.ts, which is not a file Faultline tests in this project."]);
        assert.deepEqual(kept.failures.map((failure) => failure.token), ["src/a.ts:next;seed=7;values=b2"]);
        assert.deepEqual(kept.read, []);
    });

    test("the answer of every replayed crash is handed back with the values it was made with", async () => {
        const kept = await replayKeptCrashes(walked, ["src/a.ts:next;seed=7;values=b2", "src/a.ts:next;seed=7;values=b0"], new Map(), replayingBy(() => crashingWorker(emptyLog(), undefined), 1, []));
        assert.deepEqual(kept.answers.map((answer) => answer.token), ["src/a.ts:next;seed=7;values=b2", "src/a.ts:next;seed=7;values=b0"]);
        assert.deepEqual(kept.answers.map((answer) => answer.failures.length), [1, 0]);
        assert.deepEqual(kept.answers.map((answer) => answer.arguments), [["b2"], ["b0"]]);
    });

    test("a kept crash with a known answer is answered from it and no worker is made for it", async () => {
        const token = "src/a.ts:next;seed=7;values=b2";
        const log = emptyLog();
        const kept = await replayKeptCrashes(walked, [token, "src/a.ts:next;seed=7;values=b0"], new Map([[token, answerOf(token)]]), replayingBy(() => crashingWorker(log, undefined), 1, []));
        assert.deepEqual(kept.kept, [token, "src/a.ts:next;seed=7;values=b0"]);
        assert.deepEqual(kept.read, [token]);
        assert.deepEqual(kept.failures, answerOf(token).failures);
        assert.deepEqual(kept.answers[0], answerOf(token));
        assert.equal(log.opens, 1);
        assert.deepEqual(log.calls, ["src/a.ts:next;seed=7;values=b0"]);
    });
});

describe("replayFromQueue", () => {
    test("one replayer takes every token in turn and answers each", async () => {
        const queue: IReplayQueue = {
            tokens: ["src/a.ts:next;seed=7;values=b2", "src/gone.ts:f;seed=1"],
            next: 0,
            done: 0,
            results: new Map(),
        };
        const lines: string[] = [];
        await replayFromQueue(walked, queue, replayingBy(() => crashingWorker(emptyLog(), undefined), 1, lines));
        assert.equal(queue.next, 2);
        assert.equal(queue.done, 2);
        assert.equal(queue.results.get("src/a.ts:next;seed=7;values=b2")?.ok, true);
        assert.equal(queue.results.get("src/gone.ts:f;seed=1")?.ok, false);
        assert.deepEqual(lines, ["  Replaying kept crashes: 1 of 2 done.", "  Replaying kept crashes: 2 of 2 done."]);
    });
});

describe("replayProgressLine", () => {
    test("the line says how many of the kept crashes have been replayed", () => {
        assert.equal(replayProgressLine({
            tokens: ["a", "b", "c"],
            next: 2,
            done: 1,
            results: new Map(),
        }), "  Replaying kept crashes: 1 of 3 done.");
    });

    test("an empty queue or more done than queued is a programmer error", () => {
        assert.throws(() => replayProgressLine({
            tokens: [],
            next: 0,
            done: 0,
            results: new Map(),
        }), assert.AssertionError);
        assert.throws(() => replayProgressLine({
            tokens: ["a"],
            next: 1,
            done: 2,
            results: new Map(),
        }), assert.AssertionError);
    });
});

describe("keptCrashesLine", () => {
    test("the line counts the kept crashes replayed and those that still fail", async () => {
        const kept = await replayKeptCrashes(walked, ["src/a.ts:next;seed=7;values=b2", "src/a.ts:next;seed=7;values=b0"], new Map(), replayingBy(() => crashingWorker(emptyLog(), undefined), 1, []));
        assert.equal(keptCrashesLine(kept), "Replayed 2 kept crashes, 1 still fails.");
        assert.equal(keptCrashesLine({
            kept: ["t"],
            dropped: [],
            failures: [],
            answers: [],
            read: [],
        }), "Replayed 1 kept crash, 0 still fail.");
    });

    test("kept crashes answered from the cache are counted as read, apart from those replayed", () => {
        const token = "src/a.ts:next;seed=7;values=b2";
        assert.equal(keptCrashesLine({
            kept: [token, "u"],
            dropped: [],
            failures: answerOf(token).failures,
            answers: [],
            read: [token, "u"],
        }), "Read 2 kept crashes from the cache, 1 still fails.");
        assert.equal(keptCrashesLine({
            kept: [token],
            dropped: [],
            failures: answerOf(token).failures,
            answers: [],
            read: [token],
        }), "Read 1 kept crash from the cache, 1 still fails.");
        assert.equal(keptCrashesLine({
            kept: [token, "u", "v"],
            dropped: [],
            failures: answerOf(token).failures,
            answers: [],
            read: [token],
        }), "Replayed 2 kept crashes and read 1 from the cache, 1 still fails.");
    });
});
