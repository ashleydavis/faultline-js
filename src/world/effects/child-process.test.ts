// Tests for the replacement of `node:child_process`.
//
// The goal is to show that no program is started: every way of starting one gets a stand-in that
// prints no output and exits with code 0 with no failure planned. It fails as `docs/FAILURES.md`
// says with each failure planned at its place. The method is to put a run in flight, start a
// program the way code under test does and read back what came back. With no run in flight every
// call goes to the real module, which is replaced here by stand-ins, so the test checks each call
// is handed on with the same arguments and its answer handed back. No program is ever started.

import assert from "node:assert/strict";
import type * as childProcessModule from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import type * as utilModule from "node:util";
import { describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import type { PlannedFailure } from "../injector.ts";
import { RunSubject } from "../subject.ts";
import childProcess, { ChildProcess, exec, execFile, execFileSync, execSync, fork, programAnswer, spawn, spawnSync } from "./child-process.ts";

// The real module with every way of starting a program replaced by a stand-in that starts nothing
// and answers with a value of its own, so a test sees whether a call reached it and what came back.
jest.mock("node:child_process", () => {
    const actual = jest.requireActual<typeof childProcessModule>("node:child_process");
    const { promisify: promised } = jest.requireActual<typeof utilModule>("node:util");
    const exec = jest.fn(() => "real exec");
    const execFile = jest.fn(() => "real execFile");
    Object.defineProperty(exec, promised.custom, {
        value: jest.fn(async () => ({
            stdout: "real out",
            stderr: "real err",
        })),
    });
    Object.defineProperty(execFile, promised.custom, {
        value: jest.fn(async () => ({
            stdout: "real file out",
            stderr: "real file err",
        })),
    });
    return {
        ...actual,
        execSync: jest.fn(() => "real execSync"),
        execFileSync: jest.fn(() => "real execFileSync"),
        spawnSync: jest.fn(() => ({
            stdout: "real spawnSync",
        })),
        spawn: jest.fn(() => "real spawn"),
        fork: jest.fn(() => "real fork"),
        exec,
        execFile,
    };
});

// The stand-ins above, as the test reads them back.
const realModule = jest.requireMock<Record<string, jest.Mock>>("node:child_process");

// Runs `work` with one run in flight and waits for it. The run injects `planned`, or nothing when
// it is undefined.
export async function runInFlight<T>(work: (subject: RunSubject) => T | Promise<T>, planned: PlannedFailure | undefined): Promise<T> {
    const subject = new RunSubject(1, planned);
    const before = runWith(subject);
    try {
        return await work(subject);
    }
    finally {
        runWith(before);
    }
}

// Runs `work` with one run in flight that injects nothing and waits for it.
export function runWithNoFailure<T>(work: (subject: RunSubject) => T | Promise<T>): Promise<T> {
    return runInFlight(work, undefined);
}

// The failure planned for the first program started.
export function firstSpawnFailure(failure: string): PlannedFailure {
    return {
        place: {
            effect: "spawn",
            occurrence: 0,
        },
        failure,
    };
}

// What the promise forms of `exec` and `execFile` resolve to.
export interface IOutput {
    // What the program wrote on its standard output.
    stdout: string;

    // What it wrote on its standard error.
    stderr: string;
}

// What `exec` hands its callback.
export interface IExecAnswer extends IOutput {
    // What the program failed with, or null when it ended well, as Node hands it.
    error: Error | null;
}

// What a started program ended with, as its close event reports it.
export interface IClosed {
    // The code it exited with, or null when a signal ended it.
    code: number | null;

    // The signal that ended it, or null when it exited.
    signal: string | null;
}

// The promise form `util.promisify` makes of `exec`, run on `command`. The form is found through the
// symbol the replacement carries, which its type does not name, so it is called through
// `Reflect.apply`.
export function execPromised(command: string): Promise<IOutput> {
    return Reflect.apply(promisify(exec), undefined, [command]);
}

// The promise form `util.promisify` makes of `execFile`, run on `file` with `fileArguments`.
export function execFilePromised(file: string, fileArguments: string[]): Promise<IOutput> {
    return Reflect.apply(promisify(execFile), undefined, [file, fileArguments]);
}

// Runs `command` with `exec` and waits for what it hands its callback, so a test reads the error
// and the output by name.
export function runExec(command: string): Promise<IExecAnswer> {
    return new Promise((settle) => {
        exec(command, (error: Error | null, stdout: string, stderr: string) => {
            settle({
                error,
                stdout,
                stderr,
            });
        });
    });
}

// Waits for a started program to close and reads what it ended with.
export async function waitForClose(started: ChildProcess): Promise<IClosed> {
    const [code, signal] = await once(started, "close");
    return {
        code,
        signal,
    };
}

// The field `name` of an error a started program failed with. Node puts the details on the error
// object itself, under names its type does not declare, so the field is read through `Reflect`.
export function errorField(error: unknown, name: string): unknown {
    assert.ok(error instanceof Error);
    return Reflect.get(error, name);
}

describe("programs that run", () => {
    test("a program run synchronously prints nothing and its output is bytes or text as asked", async () => {
        await runWithNoFailure(() => {
            assert.deepEqual(execSync("git --version"), Buffer.alloc(0));
            assert.equal(execSync("git --version", {
                encoding: "utf8",
            }), "");
            assert.equal(execFileSync("git", ["--version"], {
                encoding: "utf8",
            }), "");
            assert.deepEqual(execFileSync("git"), Buffer.alloc(0));
            const answer = spawnSync("git", ["--version"], {
                encoding: "utf8",
            });
            assert.equal(answer.status, 0);
            assert.equal(answer.signal, null);
            assert.equal(answer.stdout, "");
            assert.equal(answer.stderr, "");
            assert.equal(answer.error, undefined);
        });
    });

    test("a started program spawns, prints nothing and exits with code 0", async () => {
        await runWithNoFailure(async () => {
            const started = spawn("git", ["status"]);
            const heard: (string | Buffer)[] = [];
            started.on("spawn", () => heard.push("spawn"));
            started.stdout.on("data", (piece: Buffer) => heard.push(piece));
            const closed = await waitForClose(started);
            assert.deepEqual(heard, ["spawn"]);
            assert.equal(closed.code, 0);
            assert.equal(closed.signal, null);
            assert.equal(started.exitCode, 0);
            assert.equal(started.pid, 0);
        });
    });

    test("a program started with exec hands its callback no error and no output", async () => {
        const answer = await runWithNoFailure(() => runExec("ls"));
        assert.equal(answer.error, null);
        assert.equal(answer.stdout, "");
        assert.equal(answer.stderr, "");
        assert.deepEqual(await runWithNoFailure(() => execPromised("ls")), {
            stdout: "",
            stderr: "",
        });
        assert.deepEqual(await runWithNoFailure(() => execFilePromised("ls", [])), {
            stdout: "",
            stderr: "",
        });
        const closed = await runWithNoFailure(() => waitForClose(execFile("ls", ["-l"])));
        assert.equal(closed.code, 0);
    });

    test("a forked program takes a message and sends none", async () => {
        await runWithNoFailure(async () => {
            const forked = fork("worker.js");
            let heard = 0;
            forked.on("message", () => {
                heard += 1;
            });
            assert.equal(forked.send(), true);
            forked.disconnect();
            forked.ref();
            forked.unref();
            assert.equal(forked.kill(), true);
            await waitForClose(forked);
            assert.equal(heard, 0);
            assert.equal(forked.killed, true);
        });
    });

    test("a program started is one place and the failures there depend on what the caller set", async () => {
        const reached = await runWithNoFailure((subject) => {
            spawn("a");
            execSync("b");
            spawn("c", [], {
                timeout: 100,
            });
            spawnSync("d", [], {
                maxBuffer: 10,
            });
            return subject.injector.reached.map((reachedPlace) => reachedPlace.failures);
        });
        // What `docs/FAILURES.md` lists for starting a program whatever the caller set. Every call
        // after the first adds the failure that its kind of call or its options make possible.
        const startFailures = ["program-not-found", "access-denied", "too-many-open-files", "exits-with-a-non-zero-code", "killed-by-a-signal"];
        assert.deepEqual(reached, [startFailures, [...startFailures, "output-past-the-limit"], [...startFailures, "timed-out"], [...startFailures, "output-past-the-limit"]]);
    });
});

//
// What the scenario says `ioreg` answers: its output, a line on its error stream and code 0.
//
const ioregAnswer = {
    stdout: "\"IOPlatformUUID\" = \"ABC\"\n",
    stderr: "warning\n",
    exitCode: 0,
};

describe("programs a scenario answered for", () => {
    test("every synchronous way of running the program gives what the scenario said it prints", async () => {
        await runWithNoFailure((subject) => {
            subject.programs.set("ioreg", ioregAnswer);
            assert.equal(execFileSync("ioreg", ["-rd1"], {
                encoding: "utf8",
            }), ioregAnswer.stdout);
            assert.deepEqual(execSync("ioreg -rd1 -c IOPlatformExpertDevice"), Buffer.from(ioregAnswer.stdout));
            assert.equal(execFileSync("/usr/sbin/ioreg", [], {
                encoding: "utf8",
            }), ioregAnswer.stdout);
            const answer = spawnSync("ioreg", [], {
                encoding: "utf8",
            });
            assert.equal(answer.stdout, ioregAnswer.stdout);
            assert.equal(answer.stderr, ioregAnswer.stderr);
            assert.deepEqual(answer.output, [null, ioregAnswer.stdout, ioregAnswer.stderr]);
        });
    });

    test("a started program's streams carry what it prints, and exec's callback is given it", async () => {
        await runWithNoFailure(async (subject) => {
            subject.programs.set("ioreg", ioregAnswer);
            const child = spawn("ioreg", []);
            const chunks: Buffer[] = [];
            child.stdout.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
            });
            await once(child, "close");
            assert.equal(Buffer.concat(chunks).toString("utf8"), ioregAnswer.stdout);
            const printed = await promisify(exec)("ioreg -rd1");
            assert.deepEqual(printed, {
                stdout: ioregAnswer.stdout,
                stderr: ioregAnswer.stderr,
            });
        });
    });

    test("a program the scenario says exits badly fails with its code and what it printed", async () => {
        await runWithNoFailure((subject) => {
            subject.programs.set("git", {
                stdout: "partial\n",
                stderr: "fatal: not a repository\n",
                exitCode: 128,
            });
            let failed: unknown;
            try {
                execFileSync("git", ["status"], {
                    encoding: "utf8",
                });
            }
            catch (error) {
                failed = error;
            }
            assert.ok(failed instanceof Error);
            assert.equal(Reflect.get(failed, "status"), 128);
            assert.equal(Reflect.get(failed, "stderr"), "fatal: not a repository\n");
            assert.equal(Reflect.get(failed, "stdout"), "partial\n");
        });
    });

    test("a program no scenario answered for prints nothing and exits with code 0", async () => {
        await runWithNoFailure((subject) => {
            subject.programs.set("ioreg", ioregAnswer);
            assert.equal(execFileSync("uname", [], {
                encoding: "utf8",
            }), "");
            assert.equal(programAnswer(subject.programs, "uname -a"), undefined);
            assert.equal(programAnswer(subject.programs, "  ioreg  -l"), ioregAnswer);
        });
    });
});

describe("programs that fail", () => {
    // The code Node gives each failure that stops a program starting.
    for (const [failure, code] of Object.entries({
        "program-not-found": "ENOENT",
        "access-denied": "EACCES",
        "too-many-open-files": "EMFILE",
    })) {
        test(`${failure} fails every way of starting a program with ${code}`, async () => {
            await runInFlight(() => {
                assert.throws(() => execSync("git"), {
                    code,
                    syscall: "spawn git",
                    path: "git",
                });
            }, firstSpawnFailure(failure));
            await runInFlight(() => {
                assert.throws(() => execFileSync("git"), {
                    code,
                });
            }, firstSpawnFailure(failure));
            await runInFlight(() => {
                assert.equal(errorField(spawnSync("git").error, "code"), code);
            }, firstSpawnFailure(failure));
            const [error] = await runInFlight(async () => {
                const started = spawn("git");
                // `once` rejects on an error event, so the close is waited for with a listener.
                const closed = new Promise((done) => started.on("close", done));
                const failed = once(started, "error");
                await closed;
                return failed;
            }, firstSpawnFailure(failure));
            assert.equal(errorField(error, "code"), code);
            const handed = await runInFlight(() => runExec("git"), firstSpawnFailure(failure));
            assert.equal(errorField(handed.error, "code"), code);
        });
    }

    test("a program that exits with a non-zero code is reported with its code", async () => {
        await runInFlight(() => {
            assert.throws(() => execSync("make"), {
                status: 1,
                killed: false,
                message: "Command failed: make\n",
            });
        }, firstSpawnFailure("exits-with-a-non-zero-code"));
        await runInFlight(() => {
            assert.equal(spawnSync("make").status, 1);
        }, firstSpawnFailure("exits-with-a-non-zero-code"));
        await runInFlight(() => {
            assert.throws(() => execFileSync("make"), {
                status: 1,
            });
        }, firstSpawnFailure("exits-with-a-non-zero-code"));
        const closed = await runInFlight(() => waitForClose(spawn("make")), firstSpawnFailure("exits-with-a-non-zero-code"));
        assert.equal(closed.code, 1);
        await runInFlight(() => assert.rejects(execPromised("make"), {
            status: 1,
            stdout: "",
            stderr: "",
        }), firstSpawnFailure("exits-with-a-non-zero-code"));
    });

    test("a program killed by a signal exits with the signal", async () => {
        const closed = await runInFlight(() => waitForClose(spawn("make")), firstSpawnFailure("killed-by-a-signal"));
        assert.equal(closed.code, null);
        assert.equal(closed.signal, "SIGTERM");
        await runInFlight(() => {
            assert.throws(() => execSync("make"), {
                signal: "SIGTERM",
                killed: true,
            });
        }, firstSpawnFailure("killed-by-a-signal"));
    });

    test("a program that prints past the limit fails with ERR_CHILD_PROCESS_STDIO_MAXBUFFER", async () => {
        await runInFlight(() => {
            assert.throws(() => execSync("cat big"), {
                code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
                name: "RangeError",
            });
        }, firstSpawnFailure("output-past-the-limit"));
        await runInFlight(() => {
            assert.equal(errorField(spawnSync("cat", [], {
                maxBuffer: 1,
            }).error, "code"), "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
        }, firstSpawnFailure("output-past-the-limit"));
    });

    test("a program that runs past its timeout is killed and a synchronous one fails with ETIMEDOUT", async () => {
        await runInFlight(() => {
            assert.throws(() => execSync("sleep 9", {
                timeout: 10,
            }), {
                code: "ETIMEDOUT",
                signal: "SIGTERM",
            });
        }, firstSpawnFailure("timed-out"));
        await runInFlight(() => {
            assert.equal(errorField(spawnSync("sleep", ["9"], {
                timeout: 10,
            }).error, "code"), "ETIMEDOUT");
        }, firstSpawnFailure("timed-out"));
    });

    test("a program given a signal can be aborted at its place", async () => {
        await runInFlight(() => {
            assert.throws(() => execSync("make", {
                signal: new AbortController().signal,
            }), {
                name: "AbortError",
            });
        }, {
            place: {
                effect: "cancellation",
                occurrence: 0,
            },
            failure: "operation-aborted",
        });
    });
});

// The arguments the stand-in `name` was last called with, copied out of the mock's own realm.
export function lastCall(name: string): unknown[] {
    return Array.from(realModule[name].mock.lastCall ?? []);
}

// The promise form a stand-in carries, as `util.promisify` finds it.
export function promiseForm(name: string): jest.Mock {
    const found: unknown = Reflect.get(realModule[name], promisify.custom);
    assert.ok(jest.isMockFunction(found), `The stand-in ${name} carries no promise form.`);
    return found;
}

// A callback a call is handed, which nothing calls while the real module is stood in for.
export function ignoreAnswer(): void {
    return undefined;
}

describe("with no run in flight", () => {
    test("each synchronous call is handed to the real module with its arguments and its answer comes back", () => {
        const options = {
            encoding: "utf8",
        };
        assert.equal(execSync("echo real", options), "real execSync");
        assert.deepEqual(lastCall("execSync"), ["echo real", options]);
        assert.equal(execFileSync("echo", ["real"], options), "real execFileSync");
        assert.deepEqual(lastCall("execFileSync"), ["echo", ["real"], options]);
        assert.deepEqual(spawnSync("echo", ["real"], options), {
            stdout: "real spawnSync",
        });
        assert.deepEqual(lastCall("spawnSync"), ["echo", ["real"], options]);
    });

    test("each call that starts a program is handed to the real module with its arguments and its answer comes back", () => {
        const options = {
            execArgv: [],
        };
        assert.equal(spawn("true", [], options), "real spawn");
        assert.deepEqual(lastCall("spawn"), ["true", [], options]);
        assert.equal(fork("-e", [], options), "real fork");
        assert.deepEqual(lastCall("fork"), ["-e", [], options]);
        assert.equal(exec("echo real", ignoreAnswer), "real exec");
        assert.deepEqual(lastCall("exec"), ["echo real", ignoreAnswer]);
        assert.equal(execFile("true", ["a"], ignoreAnswer), "real execFile");
        assert.deepEqual(lastCall("execFile"), ["true", ["a"], ignoreAnswer]);
        assert.equal(childProcess.exec, exec);
    });

    test("the promise forms are the real module's promise forms, with the same arguments and answers", async () => {
        assert.deepEqual(await execPromised("echo real"), {
            stdout: "real out",
            stderr: "real err",
        });
        assert.deepEqual(Array.from(promiseForm("exec").mock.lastCall ?? []), ["echo real"]);
        assert.deepEqual(await execFilePromised("echo", ["real"]), {
            stdout: "real file out",
            stderr: "real file err",
        });
        assert.deepEqual(Array.from(promiseForm("execFile").mock.lastCall ?? []), ["echo", ["real"]]);
    });
});
