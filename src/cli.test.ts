//
// Tests the command line entry point. Goal: a bare `flt` runs Faultline over the project and hands
// back the run's exit code; `--replay` walks the project and replays the token, printing the answer
// and handing back its exit code; `clear` throws the kept results away and leaves the kept crashes;
// a command line that cannot be read and a project whose `faultline.config.yaml` cannot be read are
// refused with a sentence. Method: call `main`, `clearCommand` and `replayCommand` with an output
// that keeps every line and a stand-in worker, over a project held in a file system in memory.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { clearCommand, main, replayCommand } from "./cli.ts";
import { createFakeFileSystem, type IFakeFileSystem } from "./lib/fake-files.test.ts";
import { defaultOptions } from "./options.ts";
import type { IOutput } from "./report/output.ts";
import type { ICallResult, IOpenRequest, IShardFacts } from "./run/messages.ts";
import type { IRunEnvironment } from "./run/run.ts";
import type { IWorker } from "./run/worker.ts";

//
// Every line an output was given, by where it went.
//
export class KeptLines implements IOutput {
    //
    // The lines of the report.
    //
    lines: string[] = [];

    //
    // The lines of errors.
    //
    errors: string[] = [];

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
    // Keeps nothing, because these tests do not read progress.
    //
    showProgress(): void {
        return;
    }
}

//
// A project with one source file whose one function `f` has one code path.
//
export function projectFiles(): IFakeFileSystem {
    return createFakeFileSystem({
        "/project/src/a.ts": "export function f(): number {\n    return 1;\n}\n",
        "/project/package.json": "{ \"name\": \"project\" }\n",
    });
}

//
// A stand-in worker over `src/a.ts` whose one function `f` passes and exercises its one code path.
// It counts the workers made.
//
export function passingWorker(made: string[]): IWorker {
    made.push("worker");
    return {
        open: async (request: IOpenRequest): Promise<IShardFacts> => ({
            file: request.file,
            functions: [{
                label: "f",
                name: "f",
                line: 1,
                uncallable: undefined,
                unbuildable: undefined,
                choices: [],
                targets: ["src/a.ts\tf:entered"],
            }],
            scenarios: [],
            paths: [{
                key: "src/a.ts\tf:entered",
                file: "src/a.ts",
                line: 1,
                fn: "f",
                describe: "the body of f",
            }],
            notProvable: [],
            uncallable: [],
            simProblems: [],
            loadProblem: undefined,
        }),
        read: async (): Promise<string[]> => [],
        call: async (token: string): Promise<ICallResult> => ({
            token,
            exercised: ["src/a.ts\tf:entered"],
            reached: [],
            injected: false,
            failures: [],
            arguments: [],
        }),
        stop: async (): Promise<void> => undefined,
    };
}

//
// An environment over `files` with the project at `/project`, whose workers are `passingWorker`s.
//
export function environmentOf(files: IFakeFileSystem, output: KeptLines, made: string[]): IRunEnvironment {
    return {
        files,
        projectRoot: "/project",
        toolModules: "/faultline/src",
        faultlineVersion: "0.1.0",
        seed: 3,
        jobs: 1,
        output,
        createWorker: (): IWorker => passingWorker(made),
        now: (): number => 0,
    };
}

describe("main", () => {
    test("a bare flt runs Faultline over the project and hands back its exit code", async () => {
        const output = new KeptLines();
        const made: string[] = [];
        const code = await main([], environmentOf(projectFiles(), output, made));
        assert.equal(code, 0);
        assert.equal(output.lines[0], "Fault testing the JavaScript and TypeScript source in project.");
        assert(output.lines.includes("  Coverage: 1 of 1 code paths, 100%."));
        assert(made.length > 0);
    });

    test("--replay replays the token in the project and prints the answer", async () => {
        const output = new KeptLines();
        const code = await main(["--replay", "src/a.ts:f;seed=3"], environmentOf(projectFiles(), output, []));
        assert.equal(code, 0);
        assert.deepEqual(output.lines, ["The call to f passed."]);
        assert.deepEqual(output.errors, []);
    });

    test("clear throws the kept results away", async () => {
        const output = new KeptLines();
        const code = await main(["clear"], environmentOf(projectFiles(), output, []));
        assert.equal(code, 0);
        assert.deepEqual(output.lines, ["Threw away the kept results in node_modules/.cache/faultline/results and the compiled files in node_modules/.cache/faultline/compiled, so the next run compiles and executes every file."]);
    });

    test("a command line that cannot be read is refused with its sentence", async () => {
        const output = new KeptLines();
        const made: string[] = [];
        const code = await main(["--replay"], environmentOf(projectFiles(), output, made));
        assert.equal(code, 1);
        assert.deepEqual(output.errors, ["The option --replay needs a value after it, written as --replay \"<token>\"."]);
        assert.deepEqual(made, []);
    });

    test("a project root that is not an absolute path is a defect in the caller", async () => {
        const environment = {
            ...environmentOf(projectFiles(), new KeptLines(), []),
            projectRoot: "project",
        };
        await assert.rejects(main([], environment), assert.AssertionError);
    });
});

describe("clearCommand", () => {
    test("the kept results go and the kept crashes stay", async () => {
        const files = createFakeFileSystem({
            "/project/node_modules/.cache/faultline/results/a.json": "{}",
            "/project/node_modules/.cache/faultline/crashes.txt": "src/a.ts:f;seed=1\n",
        });
        const code = await clearCommand(environmentOf(files, new KeptLines(), []));
        assert.equal(code, 0);
        assert.equal(files.files.has("/project/node_modules/.cache/faultline/results/a.json"), false);
        assert.equal(files.files.get("/project/node_modules/.cache/faultline/crashes.txt"), "src/a.ts:f;seed=1\n");
    });
});

describe("replayCommand", () => {
    test("the token is replayed in the walked project and the answer printed", async () => {
        const output = new KeptLines();
        const made: string[] = [];
        const code = await replayCommand(environmentOf(projectFiles(), output, made), {
            ...defaultOptions(),
            command: "replay",
            token: "src/a.ts:f;seed=3",
        });
        assert.equal(code, 0);
        assert.deepEqual(output.lines, ["The call to f passed."]);
        assert.deepEqual(made, ["worker"]);
    });

    test("a project whose faultline.config.yaml cannot be read says why", async () => {
        const output = new KeptLines();
        const broken = createFakeFileSystem({
            "/project/faultline.config.yaml": "include: [lib\n",
        });
        const code = await replayCommand(environmentOf(broken, output, []), {
            ...defaultOptions(),
            command: "replay",
            token: "src/a.ts:f;seed=3",
        });
        assert.equal(code, 1);
        assert.equal(output.errors.length, 1);
        assert.match(output.errors[0]!, /^The faultline\.config\.yaml is not valid YAML: .*\.$/);
    });

    test("a replay with no token is a defect in the command line parser", async () => {
        await assert.rejects(replayCommand(environmentOf(projectFiles(), new KeptLines(), []), {
            ...defaultOptions(),
            command: "replay",
        }), assert.AssertionError);
    });
});
