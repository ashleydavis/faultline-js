//
// Tests what `flt` does, in this process: it refuses an old Node or Bun in one sentence and exits 1,
// and otherwise hands the arguments and the directory to the run, whose workers start their
// children from the directory the entry file sits in.
//
// The method is to call `main` with the entry file of a clone at `/tool`, a project and
// Faultline's `package.json` in a file system in memory, the runtime's version and the process's
// directory and arguments replaced for the test, and a worker factory whose children end as soon
// as they are asked anything, so no process is started and no disk is read. That `flt` started as
// a real process refuses an old runtime is checked by `src/smoke/node-refusal.smoke.ts`.
//

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, describe, jest, test } from "@jest/globals";
import { createFakeFileSystem, type IFakeFileSystem } from "./lib/fake-files.test.ts";
import { createProjectWorker, main, processEnvironment, readOpenLimitMs, readToolVersion, toolModulesOf } from "./main.ts";
import { ConsoleOutput } from "./report/output.ts";
import { openLimitMs, type IChildProcess, type IErrorStream, type IWorkerFactory, type IWorkerSettings } from "./run/worker.ts";

//
// The URL of the entry file in a clone at `/tool`, whose `package.json` is two directories up.
//
const entryUrl = "file:///tool/src/bin/flt.ts";

//
// What the runtime said its Node version was before any test changed it, put back after each test.
//
const nodeBefore = process.versions.node;

//
// What the process was going to exit with before a test set it, put back after each test.
//
const exitCodeBefore = process.exitCode;

//
// Faultline's own `package.json`, needing Node 24 or later, and a project at `/project` with one
// source file, in memory.
//
export function toolFiles(): IFakeFileSystem {
    return createFakeFileSystem({
        "/tool/package.json": "{\n    \"version\": \"0.1.0\",\n    \"engines\": {\n        \"node\": \">=24.0.0\"\n    }\n}\n",
        "/project/src/a.ts": "export function f(): number {\n    return 1;\n}\n",
    });
}

//
// Makes the runtime say it is Node `node`, and Bun `bun` when one is given, until the test ends.
// `process.versions` itself cannot be replaced, but each of its entries can be redefined.
//
export function runAs(node: string, bun: string | undefined): void {
    Object.defineProperty(process.versions, "node", {
        value: node,
        enumerable: true,
        configurable: true,
        writable: false,
    });
    if (bun) {
        Object.defineProperty(process.versions, "bun", {
            value: bun,
            enumerable: true,
            configurable: true,
            writable: false,
        });
    }
    assert.equal(process.versions.node, node);
}

//
// Starts `flt` in `/project` with `typed` after it on the command line, and hands back what it
// wrote on its error stream, keeping it off the test's own.
//
export async function runFlt(typed: string[], factory: IWorkerFactory): Promise<string[]> {
    jest.replaceProperty(process, "argv", ["/usr/bin/node", "/tool/src/bin/flt.ts", ...typed]);
    jest.spyOn(process, "cwd").mockReturnValue("/project");
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    const errors = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    await main(entryUrl, toolFiles(), factory);
    //
    // A mock's calls are kept in an array of Jest's own realm, so they are copied into this one
    // for `assert.deepEqual`.
    //
    return Array.from(errors.mock.calls, (call) => String(call[0]));
}

//
// An error stream that never says anything.
//
export class QuietStream extends EventEmitter implements IErrorStream {
    //
    // Takes the encoding and keeps nothing, because nothing is ever written.
    //
    setEncoding(): this {
        return this;
    }
}

//
// A child that ends on the next turn after it is sent anything, the way a child that cannot start
// does, so a worker over it never waits.
//
export class EndingChild extends EventEmitter implements IChildProcess {
    //
    // Set once it has ended.
    //
    exitCode: number | null = null;

    //
    // It always ends with an exit code, never a signal.
    //
    signalCode: NodeJS.Signals | null = null;

    //
    // Its error stream.
    //
    stderr = new QuietStream();

    //
    // Ends on the next turn whatever it was sent.
    //
    send(): boolean {
        setImmediate(() => {
            this.exitCode = 1;
            this.emit("exit", 1, null);
        });
        return true;
    }

    //
    // Ends at once.
    //
    kill(): boolean {
        this.exitCode = 1;
        this.emit("exit", 1, null);
        return true;
    }
}

//
// A worker factory whose children end as soon as they are asked anything, keeping the settings
// each was started with.
//
export class KeptFactory implements IWorkerFactory {
    //
    // The settings of every child started, in order.
    //
    settings: IWorkerSettings[] = [];

    //
    // Starts an ending child and keeps its settings.
    //
    create(settings: IWorkerSettings): IChildProcess {
        this.settings.push(settings);
        return new EndingChild();
    }
}

afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = exitCodeBefore;
    runAs(nodeBefore, undefined);
    Reflect.deleteProperty(process.versions, "bun");
});

describe("main", () => {
    test("an old Node is refused in one sentence and the process exits 1", async () => {
        runAs("22.22.2", undefined);
        const written = await runFlt([], new KeptFactory());
        assert.equal(process.exitCode, 1);
        assert.deepEqual(written, ["Faultline needs Node 24.0.0 or later and this is Node 22.22.2, so install Node 24 or later and run it again.\n"]);
    });

    test("an open limit that is not a whole number of milliseconds is refused in one sentence and the process exits 1", async () => {
        runAs("24.22.0", undefined);
        process.env["FAULTLINE_OPEN_LIMIT_MS"] = "soon";
        try {
            const factory = new KeptFactory();
            const written = await runFlt([], factory);
            assert.equal(process.exitCode, 1);
            assert.deepEqual(written, ["FAULTLINE_OPEN_LIMIT_MS is \"soon\", and it takes a whole number of milliseconds from 1 up.\n"]);
            assert.equal(factory.settings.length, 0);
        }
        finally {
            delete process.env["FAULTLINE_OPEN_LIMIT_MS"];
        }
    });

    test("Bun is refused whatever Node version it reports", async () => {
        runAs("24.22.0", "1.4.3");
        const written = await runFlt([], new KeptFactory());
        assert.equal(process.exitCode, 1);
        assert.deepEqual(written, ["Faultline needs Node 24.0.0 or later and this is Bun 1.4.3, so start `flt` with Node.\n"]);
    });

    test("a Node new enough hands the arguments and the directory to the run, whose workers start from the entry file's modules", async () => {
        runAs("24.22.0", undefined);
        const factory = new KeptFactory();
        await runFlt(["--replay", "src/a.ts:f;seed=1"], factory);
        assert.equal(process.exitCode, 1);
        assert.equal(factory.settings.length, 1);
        const started = factory.settings[0];
        assert.ok(started);
        assert.equal(started.child.projectRoot, "/project");
        assert.equal(started.childEntry, "/tool/src/run/child-main.ts");
    });
});

describe("createProjectWorker", () => {
    test("a worker's child runs child-main beside the entry file's own modules, for the project given", async () => {
        const factory = new KeptFactory();
        const worker = createProjectWorker(factory, {
            entryUrl,
            projectRoot: "/project",
            openLimitMs: 5000,
        });
        const facts = await worker.open({
            kind: "open",
            file: "src/a.ts",
            sims: [],
            seed: 1,
        });
        await worker.stop();
        assert.equal(facts.file, "src/a.ts");
        assert.equal(factory.settings.length, 1);
        const started = factory.settings[0];
        assert.ok(started);
        assert.equal(started.childEntry, "/tool/src/run/child-main.ts");
        assert.equal(started.child.toolModules, "/tool/src");
        assert.equal(started.child.projectRoot, "/project");
        assert.equal(started.openLimitMs, 5000);
    });

    test("a project given by a relative path is a mistake in the caller", () => {
        assert.throws(() => createProjectWorker(new KeptFactory(), {
            entryUrl,
            projectRoot: "project",
            openLimitMs: 5000,
        }));
    });
});

describe("readOpenLimitMs", () => {
    test("with no variable set, a file may take Faultline's own limit to open", () => {
        assert.equal(readOpenLimitMs(undefined), openLimitMs);
    });

    test("a whole number of milliseconds from 1 up is the limit, and anything else is refused", () => {
        assert.equal(readOpenLimitMs("5000"), 5000);
        assert.equal(readOpenLimitMs("1"), 1);
        for (const variable of ["", "0", "-5", "1.5", "five", "05", "99999999999999999999"]) {
            assert.equal(readOpenLimitMs(variable), undefined);
        }
    });
});

describe("toolModulesOf", () => {
    test("the tool's modules are the directory above the entry file's own", () => {
        assert.equal(toolModulesOf(entryUrl), "/tool/src");
        assert.equal(toolModulesOf("file:///installed/dist/bin/flt.js"), "/installed/dist");
    });
});

describe("readToolVersion", () => {
    test("Faultline's version is read from its package.json", async () => {
        assert.equal(await readToolVersion(toolFiles(), "/tool/package.json"), "0.1.0");
    });

    test("a package.json with no version is a defect in Faultline's own package", async () => {
        const files = createFakeFileSystem({
            "/tool/package.json": "{}\n",
        });
        await assert.rejects(readToolVersion(files, "/tool/package.json"), assert.AssertionError);
    });
});

describe("processEnvironment", () => {
    test("a command works in the current directory with Faultline's version from its package.json, the process's own streams, a seed a token can carry and workers for that project", async () => {
        jest.spyOn(process, "cwd").mockReturnValue("/project");
        const factory = new KeptFactory();
        const environment = await processEnvironment(entryUrl, toolFiles(), factory, 5000);
        assert.equal(environment.projectRoot, "/project");
        assert.equal(environment.toolModules, "/tool/src");
        assert.equal(environment.faultlineVersion, "0.1.0");
        assert(Number.isInteger(environment.seed));
        assert(environment.seed >= 0);
        assert(environment.seed <= 4294967295);
        assert(environment.workers > 0);
        assert(environment.output instanceof ConsoleOutput);
        assert(environment.now() > 0);
        const worker = environment.createWorker();
        await worker.open({
            kind: "open",
            file: "src/a.ts",
            sims: [],
            seed: 1,
        });
        await worker.stop();
        assert.equal(factory.settings[0]?.child.projectRoot, "/project");
        assert.equal(factory.settings[0]?.openLimitMs, 5000);
    });
});
