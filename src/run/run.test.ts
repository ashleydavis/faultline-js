//
// Tests a fault testing run. Goal: a run walks the project, runs every shard, prints the report in
// the order the Zig Faultline prints it and exits 0 only at 100% with no failure; it writes the
// report file, the kept crashes and the kept results under the cache directory and nowhere else in
// the project; a later run loads an unchanged file's result instead of running it; `--no-cache`,
// `--file`, `--function`, `--report`, `--full-report` and `--workers` do what the user guide says;
// kept crashes are replayed first and a token that names no call is dropped with a sentence; the
// first crash is shown with the values a replay of it was made with. Method: a stand-in worker
// whose shard facts and call answers are written out in each test, a project held in a file system
// in memory, an output that keeps every line and a clock that moves on a fixed step per reading.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import type { Walked } from "../discover/sources.ts";
import { createFakeFileSystem, type IFakeFileSystem } from "../lib/fake-files.test.ts";
import { defaultOptions, type IOptions } from "../options.ts";
import type { IOutput } from "../report/output.ts";
import type { IShardResult } from "./explore.ts";
import { judgeFailedOpen, type FailureKind, type ICallAnswer, type IFailure } from "./judge.ts";
import type { ICallResult, IOpenRequest, IShardFacts } from "./messages.ts";
import { resultsDirectoryOf } from "./results-cache.ts";
import {
    answersByToken,
    countCall,
    failureView,
    hasSubject,
    isCacheUsed,
    isNamed,
    isReplayedForView,
    isTokenOf,
    isTokenSelected,
    joinResults,
    narrowFacts,
    planCache,
    progressEveryMs,
    RunWorker,
    runProject,
    selectedShards,
    storedAnswers,
    withKeptFailures,
    type IRunEnvironment,
    type IRunProgress,
} from "./run.ts";
import type { IWorker } from "./worker.ts";

//
// Where the project sits.
//
const root = "/project";

//
// The text of the project's one source file, whose second line is where the stand-in crash is.
//
const sourceText = "export function f(value: number): number {\n    return value.x.y;\n}\n";

//
// Every line an output was given, by where it went.
//
export class KeptOutput implements IOutput {
    //
    // The lines of the report.
    //
    lines: string[] = [];

    //
    // The lines of errors.
    //
    errors: string[] = [];

    //
    // The progress lines.
    //
    progress: string[] = [];

    //
    // Keeps a line of the report.
    //
    print(line: string): void {
        this.lines.push(line);
    }

    //
    // Keeps a line of an error.
    //
    printError(line: string): void {
        this.errors.push(line);
    }

    //
    // Keeps a progress line.
    //
    showProgress(line: string): void {
        this.progress.push(line);
    }
}

//
// What the stand-in workers did and how they answer.
//
export interface IScript {
    //
    // What each shard holds, by its file.
    //
    facts: Map<string, IShardFacts>;

    //
    // The answer to a call.
    //
    answer(token: string): ICallResult;

    //
    // Every open and call the workers were asked for, and every stop, in order.
    //
    log: string[];
}

//
// A worker that answers from `script`.
//
export function scriptedWorker(script: IScript): IWorker {
    return {
        open: async (request: IOpenRequest): Promise<IShardFacts> => {
            script.log.push(`open ${request.file}`);
            const facts = script.facts.get(request.file);
            assert(facts !== undefined, `The script has no shard ${request.file}.`);
            return structuredClone(facts);
        },
        read: async (): Promise<string[]> => [],
        call: async (token: string): Promise<ICallResult> => {
            script.log.push(`call ${token}`);
            return script.answer(token);
        },
        stop: async (): Promise<void> => {
            script.log.push("stop");
        },
    };
}

//
// The facts of `src/a.ts`: one function `f` with two values for its one parameter and two code
// paths, its start and the read on line 2.
//
export function sourceFacts(): IShardFacts {
    return {
        file: "src/a.ts",
        functions: [{
            label: "f",
            name: "f",
            line: 1,
            uncallable: undefined,
            unbuildable: undefined,
            choices: [[{
                source: "boundary",
                index: 0,
            }, {
                source: "boundary",
                index: 1,
            }]],
            targets: ["src/a.ts\tf:entered", "src/a.ts\tread:2"],
        }],
        scenarios: [],
        paths: [{
            key: "src/a.ts\tf:entered",
            file: "src/a.ts",
            line: 1,
            fn: "f",
            describe: "the body of f",
        }, {
            key: "src/a.ts\tread:2",
            file: "src/a.ts",
            line: 2,
            fn: "f",
            describe: "the read on line 2",
        }],
        notProvable: [],
        uncallable: [],
        simProblems: [],
        loadProblem: undefined,
    };
}

//
// The answer of a call that exercised `exercised` and found `failures`.
//
export function answerOf(token: string, exercised: string[], failures: IFailure[]): ICallResult {
    return {
        token,
        exercised,
        reached: [],
        injected: false,
        failures,
        arguments: ["1"],
    };
}

//
// The crash the call `token` found at line 2 of `src/a.ts`.
//
export function crashOf(token: string): IFailure {
    return {
        kind: "crash",
        message: "The call to f crashed with TypeError: Cannot read properties of undefined (reading 'y').",
        location: "src/a.ts:2",
        key: "crash|TypeError|src/a.ts:2:20",
        token,
        stack: "TypeError: Cannot read properties of undefined (reading 'y')\n    at f (/project/src/a.ts:2:20)",
    };
}

//
// A script in which every call of `f` exercises both its code paths, so a run reaches 100%.
//
export function passingScript(): IScript {
    return {
        facts: new Map([["src/a.ts", sourceFacts()]]),
        answer: (token: string) => answerOf(token, ["src/a.ts\tf:entered", "src/a.ts\tread:2"], []),
        log: [],
    };
}

//
// A script in which a call of `f` exercises only its start, so a run stays below 100%.
//
export function missingScript(): IScript {
    return {
        facts: new Map([["src/a.ts", sourceFacts()]]),
        answer: (token: string) => answerOf(token, ["src/a.ts\tf:entered"], []),
        log: [],
    };
}

//
// A script in which a call of `f` with its second value crashes on line 2.
//
export function crashingScript(): IScript {
    return {
        facts: new Map([["src/a.ts", sourceFacts()]]),
        answer: (token: string) => token.includes("values=b1") ? answerOf(token, ["src/a.ts\tf:entered"], [crashOf(token)]) : answerOf(token, ["src/a.ts\tf:entered"], []),
        log: [],
    };
}

//
// A script in which the child ended while opening `src/a.ts`, as a worker reports it: the shard
// holds only its top level, and calling that answers with the failed open.
//
export function failedOpenScript(): IScript {
    return {
        facts: new Map([["src/a.ts", {
            ...sourceFacts(),
            functions: [{
                ...sourceFacts().functions[0]!,
                label: "(top level)",
                name: "(top level)",
                choices: [],
                targets: ["src/a.ts\t(top level):entered"],
            }],
            paths: [],
            loadProblem: "The child process opening src/a.ts ended with exit code 134.",
        }]]),
        answer: (token: string) => answerOf(token, [], [judgeFailedOpen("src/a.ts", "The call to (top level)", "with exit code 134", token)]),
        log: [],
    };
}

//
// The project in memory: a `package.json` and `src/a.ts`, plus `extra`.
//
export function projectFiles(extra: Record<string, string>): IFakeFileSystem {
    return createFakeFileSystem({
        "/project/package.json": "{ \"name\": \"project\" }\n",
        "/project/src/a.ts": sourceText,
        ...extra,
    });
}

//
// An environment over `files` whose workers answer from `script`, with a clock that moves on 300
// milliseconds per reading, a seed of 7 and two workers.
//
export function environmentOf(files: IFakeFileSystem, script: IScript, output: KeptOutput): IRunEnvironment {
    let clock = 0;
    return {
        files,
        projectRoot: root,
        toolModules: "/faultline/src",
        faultlineVersion: "0.1.0",
        seed: 7,
        workers: 2,
        output,
        createWorker: (): IWorker => scriptedWorker(script),
        now: (): number => {
            clock += 300;
            return clock;
        },
    };
}

//
// The options of a bare run with `changes` made to them.
//
export function optionsWith(changes: Partial<IOptions>): IOptions {
    return {
        ...defaultOptions(),
        ...changes,
    };
}

//
// What one run did.
//
export interface IRan {
    //
    // What it exits with.
    //
    code: number;

    //
    // What it printed.
    //
    output: KeptOutput;
}

//
// Runs Faultline over `files` with `script` and `options`.
//
export async function runWith(files: IFakeFileSystem, script: IScript, options: IOptions): Promise<IRan> {
    const output = new KeptOutput();
    const code = await runProject(environmentOf(files, script, output), options);
    return {
        code,
        output,
    };
}

//
// The project's files written by a run, which must all sit under the cache directory.
//
export function writtenOutsideCache(files: IFakeFileSystem, before: string[]): string[] {
    return [...files.files.keys()].filter((file) => !before.includes(file) && !file.startsWith("/project/node_modules/.cache/faultline/"));
}

describe("runProject", () => {
    test("a run at 100% prints the report in order, writes only under the cache directory and exits 0", async () => {
        const files = projectFiles({});
        const before = [...files.files.keys()];
        const ran = await runWith(files, passingScript(), defaultOptions());
        assert.equal(ran.code, 0);
        assert.deepEqual(ran.output.errors, []);
        assert.deepEqual(ran.output.lines, [
            "Fault testing the JavaScript and TypeScript source in project.",
            "  Running up to 2 workers at once.",
            "",
            "  Read 1 source file, 1 function.",
            "",
            "  No call crashed, hung or found an expectation false.",
            "",
            "  Coverage: 2 of 2 code paths, 100%.",
            "",
            "  Exercised 2 code paths, 1 function, 1 file.",
            "  Took 600ms.",
            "",
            "  Every failure and every thing to do is in node_modules/.cache/faultline/report.txt.",
        ]);
        assert.deepEqual(writtenOutsideCache(files, before), []);
        assert.equal(files.files.get("/project/node_modules/.cache/faultline/report.txt"), "exercised src/a.ts:1 f:entered in f\nexercised src/a.ts:2 read:2 in f\n");
        assert.equal(files.files.get("/project/node_modules/.cache/faultline/crashes.txt"), "");
    });

    test("a run below 100% prints the checklist and exits 1", async () => {
        const ran = await runWith(projectFiles({}), missingScript(), defaultOptions());
        assert.equal(ran.code, 1);
        assert(ran.output.lines.includes("  One thing to do:"));
        assert(ran.output.lines.includes("    Write a value factory that reaches the read on line 2 at src/a.ts:2 in f, or a scenario that exercises it if no value factory can."));
        assert(ran.output.lines.includes("  Coverage: 1 of 2 code paths, 50%."));
    });

    test("a crash is shown with the values its replay was made with, kept for later runs, and the run exits 1", async () => {
        const files = projectFiles({});
        const script = crashingScript();
        const ran = await runWith(files, script, optionsWith({
            noCache: true,
        }));
        assert.equal(ran.code, 1);
        const lines = ran.output.lines;
        const heading = lines.findIndex((line) => line.startsWith("-- CRASH src/a.ts:2:20 "));
        assert(heading > 0);
        assert.equal(lines[heading - 1], "");
        assert.equal(lines[heading + 1], "The call to f crashed with TypeError: Cannot read properties of undefined (reading 'y').");
        assert(lines.includes("    argument 1: 1"));
        assert(lines.includes("  2 |     return value.x.y;"));
        assert(lines.includes("    at npx flt"));
        assert(lines.includes("Reproduce it with: npx flt --replay \"src/a.ts:f;seed=7;values=b1\""));
        assert(lines.includes("  1 call crashed, in 1 function."));
        assert.equal(files.files.get("/project/node_modules/.cache/faultline/crashes.txt"), "src/a.ts:f;seed=7;values=b1\n");
        assert.equal(script.log.filter((line) => line === "open src/a.ts").length, 1, "The crash view was made from a replay, not from the answer of the call that crashed.");
    });

    test("a file that fails to open is opened once, reported from what the open said and not kept", async () => {
        const files = projectFiles({});
        const script = failedOpenScript();
        const ran = await runWith(files, script, optionsWith({
            noCache: true,
        }));
        assert.equal(ran.code, 1);
        assert(ran.output.lines.includes("The call to (top level) was not made, because the child process opening src/a.ts ended with exit code 134."));
        assert.deepEqual(script.log.filter((line) => line.startsWith("open ")), ["open src/a.ts"]);
        assert.equal(files.files.get("/project/node_modules/.cache/faultline/crashes.txt") ?? "", "");
    });

    test("a later run replays the kept crash first and reports it once", async () => {
        const files = projectFiles({});
        await runWith(files, crashingScript(), optionsWith({
            noCache: true,
        }));
        const ran = await runWith(files, crashingScript(), optionsWith({
            noCache: true,
        }));
        assert(ran.output.lines.includes("  Replayed 1 kept crash, 1 still fails."));
        assert(ran.output.lines.includes("  1 call crashed, in 1 function."));
        assert.equal(files.files.get("/project/node_modules/.cache/faultline/crashes.txt"), "src/a.ts:f;seed=7;values=b1\n");
    });

    test("a later run takes an unchanged file's kept crash and its view from the cache and makes no call", async () => {
        const files = projectFiles({});
        const first = await runWith(files, crashingScript(), defaultOptions());
        assert(first.output.lines.includes("    argument 1: 1"));
        const script = crashingScript();
        const ran = await runWith(files, script, defaultOptions());
        assert.deepEqual(script.log, []);
        assert(ran.output.lines.includes("  Read 1 kept crash from the cache, 1 still fails."));
        assert(ran.output.lines.includes("    argument 1: 1"));
        assert(ran.output.lines.includes("  1 call crashed, in 1 function."));
        assert.equal(ran.code, 1);
        assert.equal(files.files.get("/project/node_modules/.cache/faultline/crashes.txt"), "src/a.ts:f;seed=7;values=b1\n");
    });

    test("a kept crash of a changed file is replayed, and its answer is kept for the next run", async () => {
        const files = projectFiles({});
        await runWith(files, crashingScript(), defaultOptions());
        files.files.set("/project/src/a.ts", `${sourceText}// changed\n`);
        const changed = crashingScript();
        const ran = await runWith(files, changed, defaultOptions());
        assert(ran.output.lines.includes("  Replayed 1 kept crash, 1 still fails."));
        assert(changed.log.includes("call src/a.ts:f;seed=7;values=b1"));
        const script = crashingScript();
        const again = await runWith(files, script, defaultOptions());
        assert.deepEqual(script.log, []);
        assert(again.output.lines.includes("  Read 1 kept crash from the cache, 1 still fails."));
    });

    test("a kept crash that no longer names a call is dropped with a sentence", async () => {
        const files = projectFiles({
            "/project/node_modules/.cache/faultline/crashes.txt": "src/gone.ts:f;seed=1\n",
        });
        const ran = await runWith(files, passingScript(), defaultOptions());
        assert.equal(ran.code, 0);
        assert(ran.output.lines.includes("  The kept crash src/gone.ts:f;seed=1 was dropped: The token names src/gone.ts, which is not a file Faultline tests in this project."));
        assert.equal(files.files.get("/project/node_modules/.cache/faultline/crashes.txt"), "");
    });

    test("a later run loads an unchanged file's result instead of running it and prints the same report", async () => {
        const files = projectFiles({});
        const first = await runWith(files, passingScript(), defaultOptions());
        const script = passingScript();
        const second = await runWith(files, script, defaultOptions());
        assert.deepEqual(script.log, []);
        assert.equal(second.code, first.code);
        assert.deepEqual(second.output.lines.filter((line) => !line.startsWith("  Took ") && !line.startsWith("  Cached ")), first.output.lines.filter((line) => !line.startsWith("  Took ")));
        assert(second.output.lines.includes("  Cached 1 source file, 0 sim files."));
    });

    test("a changed file is run again", async () => {
        const files = projectFiles({});
        await runWith(files, passingScript(), defaultOptions());
        files.files.set("/project/src/a.ts", `${sourceText}// changed\n`);
        const script = passingScript();
        const ran = await runWith(files, script, defaultOptions());
        assert(script.log.includes("open src/a.ts"));
        assert(!ran.output.lines.some((line) => line.startsWith("  Cached ")));
    });

    test("--no-cache runs every file and keeps no results", async () => {
        const files = projectFiles({});
        await runWith(files, passingScript(), optionsWith({
            noCache: true,
        }));
        assert(![...files.files.keys()].some((file) => file.startsWith(resultsDirectoryOf(root))));
    });

    test("--file runs only that file's shard and a file Faultline does not test is refused", async () => {
        const files = projectFiles({
            "/project/src/b.ts": "export const b = 1;\n",
        });
        const script = passingScript();
        const ran = await runWith(files, script, optionsWith({
            file: "src/a.ts",
        }));
        assert.equal(ran.code, 0);
        assert(!script.log.includes("open src/b.ts"));
        const refused = await runWith(files, passingScript(), optionsWith({
            file: "src/c.ts",
        }));
        assert.equal(refused.code, 1);
        assert.deepEqual(refused.output.errors, ["The option --file names src/c.ts, which is not a source file or sim file Faultline tests in this project."]);
    });

    test("--function counts only that function, and a name no shard has is refused", async () => {
        const script = passingScript();
        const facts = sourceFacts();
        facts.functions.push({
            ...facts.functions[0]!,
            label: "g",
            name: "g",
            line: 5,
            targets: ["src/a.ts\tg:entered"],
        });
        facts.paths.push({
            key: "src/a.ts\tg:entered",
            file: "src/a.ts",
            line: 5,
            fn: "g",
            describe: "the body of g",
        });
        script.facts.set("src/a.ts", facts);
        const ran = await runWith(projectFiles({}), script, optionsWith({
            functionName: "f",
        }));
        assert.equal(ran.code, 0);
        assert(ran.output.lines.includes("  Coverage: 2 of 2 code paths, 100%."));
        assert(!script.log.some((line) => line.startsWith("call src/a.ts:g;")));
        const refused = await runWith(projectFiles({}), passingScript(), optionsWith({
            functionName: "missing",
        }));
        assert.equal(refused.code, 1);
        assert.deepEqual(refused.output.errors, ["The option --function names missing, which is no function or scenario Faultline found in this project."]);
    });

    test("--report writes the report file where it is asked for and prints that path", async () => {
        const files = projectFiles({});
        const ran = await runWith(files, passingScript(), optionsWith({
            report: "out/where-asked.txt",
        }));
        assert(files.files.has("/project/out/where-asked.txt"));
        assert.equal(ran.output.lines[ran.output.lines.length - 1], "  Every failure and every thing to do is in out/where-asked.txt.");
    });

    test("--full-report prints a block per file", async () => {
        const ran = await runWith(projectFiles({}), passingScript(), optionsWith({
            fullReport: true,
        }));
        assert(ran.output.lines.includes("Fault testing"));
        assert(ran.output.lines.includes("  src/a.ts"));
        assert(ran.output.lines.some((line) => line.startsWith("    ok   f ")));
    });

    test("a faultline.config.yaml that cannot be read stops the run with its sentence", async () => {
        const ran = await runWith(projectFiles({
            "/project/faultline.config.yaml": "include: [lib\n",
        }), passingScript(), defaultOptions());
        assert.equal(ran.code, 1);
        assert.equal(ran.output.errors.length, 1);
        assert.match(ran.output.errors[0]!, /^The faultline\.config\.yaml is not valid YAML/);
    });

    test("kept crashes that cannot be read stop the run with a sentence", async () => {
        const files = projectFiles({
            "/project/node_modules/.cache/faultline/crashes.txt": "",
        });
        files.failNext("/project/node_modules/.cache/faultline/crashes.txt", "EACCES");
        const ran = await runWith(files, passingScript(), defaultOptions());
        assert.equal(ran.code, 1);
        assert.match(ran.output.errors[0]!, /^Faultline could not read the kept crashes/);
    });

    test("a long run shows where it has got to", async () => {
        const output = new KeptOutput();
        const environment = environmentOf(projectFiles({}), missingScript(), output);
        await runProject(environment, defaultOptions());
        assert(output.progress.length > 0);
        assert.match(output.progress[0]!, /^ {2}Exercised \d+ calls? in \d+s, now in src\/a\.ts f\.$/);
    });
});

describe("selectedShards", () => {
    test("every shard, or with --file only that file's", () => {
        const shards = [{
            file: "src/a.ts",
            sims: [],
        }, {
            file: "src/b.ts",
            sims: [],
        }];
        assert.deepEqual(selectedShards(shards, undefined), shards);
        assert.deepEqual(selectedShards(shards, "src/b.ts"), [shards[1]]);
        assert.deepEqual(selectedShards(shards, "src/c.ts"), []);
    });

    test("with --file a source file's run takes in the sim files it uses, and a sim file runs alone", () => {
        const shards = [{
            file: "src/a.ts",
            sims: ["src/a.sim.ts", "global.sim.ts"],
        }, {
            file: "src/a.sim.ts",
            sims: ["src/a.sim.ts"],
        }, {
            file: "src/b.ts",
            sims: ["global.sim.ts"],
        }, {
            file: "global.sim.ts",
            sims: ["global.sim.ts"],
        }];
        assert.deepEqual(selectedShards(shards, "src/a.ts"), [shards[0], shards[1], shards[3]]);
        assert.deepEqual(selectedShards(shards, "src/b.ts"), [shards[2], shards[3]]);
        assert.deepEqual(selectedShards(shards, "src/a.sim.ts"), [shards[1]]);
    });
});

describe("isCacheUsed", () => {
    test("the cache is used only by a run of the whole project without --no-cache", () => {
        assert.equal(isCacheUsed(defaultOptions()), true);
        assert.equal(isCacheUsed(optionsWith({
            noCache: true,
        })), false);
        assert.equal(isCacheUsed(optionsWith({
            file: "src/a.ts",
        })), false);
        assert.equal(isCacheUsed(optionsWith({
            functionName: "f",
        })), false);
    });
});

describe("isTokenSelected and isNamed", () => {
    test("a narrowed run takes only the kept crashes in what it was narrowed to", () => {
        const token = "src/a.ts:f@4;seed=1";
        assert.equal(isTokenSelected(defaultOptions(), token), true);
        assert.equal(isTokenSelected(optionsWith({
            file: "src/a.ts",
        }), token), true);
        assert.equal(isTokenSelected(optionsWith({
            file: "src/b.ts",
        }), token), false);
        assert.equal(isTokenSelected(optionsWith({
            functionName: "f",
        }), token), true);
        assert.equal(isTokenSelected(optionsWith({
            functionName: "g",
        }), token), false);
        assert.equal(isTokenSelected(optionsWith({
            file: "src/b.ts",
        }), "not a token"), true);
    });

    test("a name with a line after an @ is the function of that label", () => {
        assert.equal(isNamed({
            name: "f",
            asked: "f",
        }), true);
        assert.equal(isNamed({
            name: "f@4",
            asked: "f",
        }), true);
        assert.equal(isNamed({
            name: "ff",
            asked: "f",
        }), false);
    });
});

describe("planCache", () => {
    test("with the cache not used every shard runs and no key is made", async () => {
        const plan = await planCache(environmentOf(projectFiles({}), passingScript(), new KeptOutput()), [{
            file: "src/a.ts",
            sims: [],
        }], false);
        assert.deepEqual(plan, {
            isUsed: false,
            keys: new Map(),
            entries: [undefined],
            answers: new Map(),
        });
    });

    test("with no stored result every shard runs, and each has a key", async () => {
        const plan = await planCache(environmentOf(projectFiles({}), passingScript(), new KeptOutput()), [{
            file: "src/a.ts",
            sims: [],
        }], true);
        assert.equal(plan.isUsed, true);
        assert.equal(plan.keys.size, 1);
        assert.deepEqual(plan.entries, [undefined]);
        assert.deepEqual(plan.answers, new Map());
    });
});

//
// The answer of the call `token` that found the crash on line 2 of `src/a.ts`, made with `1`.
//
export function crashAnswerOf(token: string): ICallAnswer {
    return {
        token,
        failures: [crashOf(token)],
        arguments: ["1"],
    };
}

describe("storedAnswers", () => {
    test("a stored result made with the shard's key gives the answers of its crashes and of its replays", () => {
        const found = crashAnswerOf("src/a.ts:f;seed=7;values=b1");
        const replayed = crashAnswerOf("src/a.ts:f;seed=3;values=b1");
        assert.deepEqual(storedAnswers({
            file: "src/a.ts",
            key: "k",
            entry: {
                file: "src/a.ts",
                key: "k",
                contributors: [],
                result: {
                    ...resultOf("src/a.ts"),
                    failedCalls: [found],
                },
                replays: [replayed],
            },
        }), [found, replayed]);
    });

    test("a stored result made with another key, and no stored result, give no answer", () => {
        assert.deepEqual(storedAnswers({
            file: "src/a.ts",
            key: "k2",
            entry: {
                file: "src/a.ts",
                key: "k1",
                contributors: [],
                result: resultOf("src/a.ts"),
                replays: [crashAnswerOf("src/a.ts:f;seed=3;values=b1")],
            },
        }), []);
        assert.deepEqual(storedAnswers({
            file: "src/a.ts",
            key: "k",
            entry: undefined,
        }), []);
    });
});

describe("answersByToken", () => {
    test("answers are found by their token, and the later of two for one token is kept", () => {
        const first = crashAnswerOf("t1");
        const later: ICallAnswer = {
            ...crashAnswerOf("t1"),
            arguments: ["2"],
        };
        const other = crashAnswerOf("t2");
        const byToken = answersByToken([first, other, later]);
        assert.deepEqual([...byToken.keys()], ["t1", "t2"]);
        assert.equal(byToken.get("t1"), later);
        assert.equal(byToken.get("t2"), other);
    });
});

describe("isTokenOf", () => {
    test("a token names a call of the shard of its own file and of no other", () => {
        assert.equal(isTokenOf("src/a.ts:f;seed=7;values=b1", "src/a.ts"), true);
        assert.equal(isTokenOf("src/a.ts:f;seed=7;values=b1", "src/b.ts"), false);
        assert.throws(() => isTokenOf("nothing", "src/a.ts"), assert.AssertionError);
    });
});

//
// The result of a shard of `file` with no calls.
//
export function resultOf(file: string): IShardResult {
    return {
        facts: {
            ...sourceFacts(),
            file,
        },
        tallies: [],
        exercised: [],
        failures: [],
        failedCalls: [],
    };
}

describe("joinResults", () => {
    test("stored results and the results of the shards that ran are put back in shard order", () => {
        const stored = resultOf("src/a.ts");
        const ran = [resultOf("src/b.ts"), resultOf("src/c.ts")];
        const joined = joinResults({
            isUsed: true,
            keys: new Map(),
            entries: [undefined, {
                file: "src/a.ts",
                key: "k",
                contributors: [],
                result: stored,
                replays: [],
            }, undefined],
            answers: new Map(),
        }, ran);
        assert.deepEqual(joined.map((result) => result.facts.file), ["src/b.ts", "src/a.ts", "src/c.ts"]);
    });

    test("a result left over or missing is a defect in the run", () => {
        assert.throws(() => joinResults({
            isUsed: false,
            keys: new Map(),
            entries: [undefined],
            answers: new Map(),
        }, []), assert.AssertionError);
        assert.throws(() => joinResults({
            isUsed: false,
            keys: new Map(),
            entries: [],
            answers: new Map(),
        }, [resultOf("src/a.ts")]), assert.AssertionError);
    });
});

describe("hasSubject", () => {
    test("a run found what --function names when some shard kept a function or a scenario", () => {
        const empty = resultOf("src/a.ts");
        empty.facts.functions = [];
        assert.equal(hasSubject([empty]), false);
        assert.equal(hasSubject([empty, resultOf("src/b.ts")]), true);
        const scenario = resultOf("src/a.sim.ts");
        scenario.facts.functions = [];
        scenario.facts.scenarios = [{
            name: "s",
            line: 1,
        }];
        assert.equal(hasSubject([scenario]), true);
    });
});

describe("withKeptFailures", () => {
    test("the kept crashes come first and each defect is reported once", () => {
        const kept = crashOf("src/a.ts:f;seed=1;values=b1");
        const again = crashOf("src/a.ts:f;seed=7;values=b1");
        const other: IFailure = {
            ...again,
            key: "other",
        };
        assert.deepEqual(withKeptFailures({
            kept: [kept],
            found: [again, other],
        }), [kept, other]);
    });
});

describe("narrowFacts", () => {
    test("with no --function the facts are as given", () => {
        const facts = sourceFacts();
        assert.equal(narrowFacts(facts, undefined), facts);
    });

    test("with --function only that function, its paths and a scenario of that name are kept", () => {
        const facts = sourceFacts();
        facts.scenarios.push({
            name: "f",
            line: 1,
        }, {
            name: "s",
            line: 2,
        });
        facts.notProvable.push({
            name: "default:1:x",
            file: "src/a.ts",
            line: 1,
            fn: "g",
            describe: "the default for `x`",
        });
        facts.uncallable.push({
            label: "g",
            line: 4,
            because: "it is written inside another function",
        });
        const kept = narrowFacts(facts, "f");
        assert.equal(kept.functions.length, 1);
        assert.equal(kept.paths.length, 2);
        assert.deepEqual(kept.scenarios.map((scenario) => scenario.name), ["f"]);
        assert.deepEqual(kept.notProvable, []);
        assert.deepEqual(kept.uncallable, []);
        const none = narrowFacts(facts, "h");
        assert.deepEqual(none.functions, []);
        assert.deepEqual(none.paths, []);
    });
});

describe("countCall and RunWorker", () => {
    test("each call is counted and the progress line changes at most every progressEveryMs", () => {
        const output = new KeptOutput();
        const readings = [0, progressEveryMs - 1, progressEveryMs, progressEveryMs + 1];
        const environment: IRunEnvironment = {
            ...environmentOf(projectFiles({}), passingScript(), output),
            now: (): number => readings.shift()!,
        };
        const progress: IRunProgress = {
            calls: 0,
            startedMs: 0,
            shownMs: 0,
        };
        countCall(environment, progress, "src/a.ts:f;seed=1");
        countCall(environment, progress, "src/a.ts:f;seed=1");
        countCall(environment, progress, "src/a.ts:f;seed=1");
        countCall(environment, progress, "src/a.ts:f;seed=1");
        assert.equal(progress.calls, 4);
        assert.deepEqual(output.progress, ["  Exercised 3 calls in 0s, now in src/a.ts f."]);
    });

    test("the run's worker narrows the facts it opens, counts its calls and stops the worker it wraps", async () => {
        const script = passingScript();
        const output = new KeptOutput();
        const progress: IRunProgress = {
            calls: 0,
            startedMs: 0,
            shownMs: 0,
        };
        const worker = new RunWorker(environmentOf(projectFiles({}), script, output), "missing", progress, scriptedWorker(script));
        const facts = await worker.open({
            kind: "open",
            file: "src/a.ts",
            sims: [],
            seed: 1,
        });
        assert.equal(facts.functions.length, 0);
        await worker.call("src/a.ts:f;seed=1");
        await worker.stop();
        assert.equal(progress.calls, 1);
        assert.deepEqual(script.log, ["open src/a.ts", "call src/a.ts:f;seed=1", "stop"]);
    });
});

describe("isReplayedForView", () => {
    test("only a crash and an error no code caught are replayed for their view", () => {
        const crash = crashOf("src/a.ts:f;seed=1");
        assert.equal(isReplayedForView(crash), true);
        assert.equal(isReplayedForView({
            ...crash,
            kind: "uncaught",
        }), true);
        const others: FailureKind[] = ["hang", "expectation"];
        for (const kind of others) {
            assert.equal(isReplayedForView({
                ...crash,
                kind,
            }), false);
        }
    });

    test("a shard that failed to open is shown from what the open said, without a replay", () => {
        assert.equal(isReplayedForView({
            ...crashOf("src/a.ts:(top level);seed=1"),
            key: "open|src/a.ts",
        }), false);
    });
});

describe("failureView", () => {
    //
    // A walk that found `src/a.ts`.
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

    test("a crash its replay finds again is shown with the values the replay was made with", async () => {
        const token = "src/a.ts:f;seed=7;values=b1";
        const view = await failureView(environmentOf(projectFiles({}), crashingScript(), new KeptOutput()), walked, crashOf(token), new Map());
        assert(view.includes("    argument 1: 1"));
    });

    test("a crash with an answer is shown with the answer's values and is not replayed", async () => {
        const token = "src/a.ts:f;seed=7;values=b1";
        const script = crashingScript();
        const view = await failureView(environmentOf(projectFiles({}), script, new KeptOutput()), walked, crashOf(token), new Map([[token, {
            ...crashAnswerOf(token),
            arguments: ["9"],
        }]]));
        assert(view.includes("    argument 1: 9"));
        assert.deepEqual(script.log, []);
    });

    test("a crash whose answer did not find it is shown without values and is not replayed", async () => {
        const token = "src/a.ts:f;seed=7;values=b1";
        const script = crashingScript();
        const view = await failureView(environmentOf(projectFiles({}), script, new KeptOutput()), walked, crashOf(token), new Map([[token, {
            token,
            failures: [],
            arguments: ["9"],
        }]]));
        assert(!view.some((line) => line.startsWith("    argument")));
        assert.deepEqual(script.log, []);
    });

    test("a crash its replay does not find again is shown without values", async () => {
        const token = "src/a.ts:f;seed=7;values=b1";
        const view = await failureView(environmentOf(projectFiles({}), passingScript(), new KeptOutput()), walked, crashOf(token), new Map());
        assert(!view.some((line) => line.startsWith("    argument")));
        assert(view[0]!.startsWith("-- CRASH src/a.ts:2:20 "));
    });

    test("a crash whose replay is refused is shown without values", async () => {
        const script = crashingScript();
        const view = await failureView(environmentOf(projectFiles({}), script, new KeptOutput()), walked, crashOf("src/gone.ts:f;seed=7;values=b1"), new Map());
        assert(!view.some((line) => line.startsWith("    argument")));
        assert.deepEqual(script.log, []);
    });

    test("a failure that is no crash is shown from what the run found, with no replay", async () => {
        const script = passingScript();
        const view = await failureView(environmentOf(projectFiles({}), script, new KeptOutput()), walked, {
            kind: "hang",
            message: "The call to f never returned.",
            location: "",
            key: "hang|src/a.ts|f",
            token: "src/a.ts:f;seed=7;values=b0",
            stack: "",
        }, new Map());
        assert.deepEqual(view, ["The call to f never returned."]);
        assert.deepEqual(script.log, []);
    });
});
