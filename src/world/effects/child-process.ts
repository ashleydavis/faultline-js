// What the copy imports in place of `node:child_process`.
//
// No program is started, so a fault test never changes anything outside the simulated world. A
// call gets a stand-in for the program that prints what a scenario said it prints and exits with
// the code the scenario gave, or prints nothing and exits with code 0 when no scenario answered for
// it, unless the injector says it goes wrong, and then it fails the way a real one fails: the program is not
// there, it is not allowed to run, too many files are open, it exits with a non-zero code, it is
// killed by a signal, it prints past the limit the caller set or it runs past the caller's timeout.

import { EventEmitter } from "node:events";
import realChild from "node:child_process";
import path from "node:path";
import { finished, PassThrough, Readable, Writable } from "node:stream";
import { promisify } from "node:util";
import { nowRunning } from "../current.ts";
import { abortError, CodedError, codeOf } from "../effects.ts";
import { isAborted } from "../network.ts";
import type { IProgramAnswer } from "../../sim/index.ts";

// Everything the real module has and this one does not replace. Every call that starts a program
// is declared below, and a name declared here wins over the one the star brings in.
export * from "node:child_process";

// What every way of starting a program can fail with, besides the two that need something the
// caller set: a limit on output and a timeout.
const startFailures = ["program-not-found", "access-denied", "too-many-open-files", "exits-with-a-non-zero-code", "killed-by-a-signal"];

// The code a program that exits badly exits with.
const failedCode = 1;

// The signal a killed program is killed with, and the one Node sends when a timeout runs out.
const killSignal = "SIGTERM";

// How one call goes.
interface Outcome {
    // What starting the program fails with, when it does not start.
    error: Error | undefined;

    // The code it exits with, or none when a signal ended it.
    code: number | null;

    // The signal that ended it, or none when it exited.
    signal: string | null;

    // Whether it printed past the caller's limit on output.
    pastLimit: boolean;

    // Whether the caller's timeout ran out.
    timedOut: boolean;

    // What it printed on its output stream.
    stdout: string;

    // What it printed on its error stream.
    stderr: string;
}

// The options a call was given, wherever in its arguments they are.
function optionsIn(args: unknown[]): Record<string, unknown> {
    for (const given of args) {
        if (given !== null && typeof given === "object" && !Array.isArray(given)) {
            return given as Record<string, unknown>;
        }
    }
    return {};
}

// What the injector made of this call. `limited` says whether the call has a limit on output, which
// `exec` and the synchronous calls always have, and the timeout is read from the options.
function outcomeFor(command: string, options: Record<string, unknown>, limited: boolean): Outcome {
    const running = nowRunning()!;
    if (isAborted(running.injector, options.signal as AbortSignal | undefined)) {
        return {
            error: abortError(),
            code: null,
            signal: killSignal,
            pastLimit: false,
            timedOut: false,
            stdout: "",
            stderr: "",
        };
    }
    const possible = [...startFailures];
    if (limited) {
        possible.push("output-past-the-limit");
    }
    if (typeof options.timeout === "number" && options.timeout > 0) {
        possible.push("timed-out");
    }
    const failure = running.injector.check("spawn", possible);
    if (failure === "program-not-found" || failure === "access-denied" || failure === "too-many-open-files") {
        const code = codeOf(failure);
        return {
            error: Object.assign(new CodedError(code, `spawn ${command} ${code}`, `spawn ${command}`, command), {
                spawnargs: [],
            }),
            code: null,
            signal: null,
            pastLimit: false,
            timedOut: false,
            stdout: "",
            stderr: "",
        };
    }
    if (failure === "exits-with-a-non-zero-code") {
        return {
            error: undefined,
            code: failedCode,
            signal: null,
            pastLimit: false,
            timedOut: false,
            stdout: "",
            stderr: "",
        };
    }
    if (failure === "killed-by-a-signal" || failure === "timed-out") {
        return {
            error: undefined,
            code: null,
            signal: killSignal,
            pastLimit: false,
            timedOut: failure === "timed-out",
            stdout: "",
            stderr: "",
        };
    }
    const answer = programAnswer(running.programs, command);
    return {
        error: undefined,
        code: answer?.exitCode ?? 0,
        signal: null,
        pastLimit: failure === "output-past-the-limit",
        timedOut: false,
        stdout: answer?.stdout ?? "",
        stderr: answer?.stderr ?? "",
    };
}

// What a scenario said the program `command` names answers, found by the command as it is given,
// by the program it starts with, which is how `exec` is given one with its arguments, and by that
// program's file name, or nothing when no scenario answered for it.
export function programAnswer(programs: Map<string, IProgramAnswer>, command: string): IProgramAnswer | undefined {
    const program = command.trim().replace(/\s.*$/s, "");
    return programs.get(command) ?? programs.get(program) ?? programs.get(path.basename(program));
}

// The error `exec` and the synchronous calls fail with for a program that did not end well, with
// what Node puts on it.
function endedBadly(command: string, outcome: Outcome): Error {
    if (outcome.pastLimit) {
        const error = new RangeError("stdout maxBuffer length exceeded");
        return Object.assign(error, {
            code: codeOf("output-past-the-limit"),
            cmd: command,
        });
    }
    const error = new Error(`Command failed: ${command}\n`);
    return Object.assign(error, {
        code: outcome.timedOut ? "ETIMEDOUT" : outcome.code,
        status: outcome.code,
        signal: outcome.signal,
        killed: outcome.signal !== null,
        cmd: command,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
    });
}

// Whether a program ended well.
function isClean(outcome: Outcome): boolean {
    return outcome.error === undefined && outcome.code === 0 && !outcome.pastLimit;
}

// What a synchronous call hands back for what a program printed: bytes, or text when an encoding
// was asked for.
function outputOf(printed: string, options: Record<string, unknown>): string | Buffer {
    const encoding = options.encoding;
    return typeof encoding === "string" && encoding !== "buffer" ? printed : Buffer.from(printed);
}

export function execSync(command: string, options?: unknown): string | Buffer {
    if (nowRunning() === undefined) {
        return realChild.execSync(command, options as never);
    }
    const given = optionsIn([options]);
    const outcome = outcomeFor(command, given, true);
    if (outcome.error !== undefined) {
        throw outcome.error;
    }
    if (!isClean(outcome)) {
        throw endedBadly(command, outcome);
    }
    return outputOf(outcome.stdout, given);
}

export function execFileSync(file: string, args?: unknown, options?: unknown): string | Buffer {
    if (nowRunning() === undefined) {
        return (realChild.execFileSync as (...given: unknown[]) => string | Buffer)(file, args, options);
    }
    const given = optionsIn([args, options]);
    const outcome = outcomeFor(file, given, true);
    if (outcome.error !== undefined) {
        throw outcome.error;
    }
    if (!isClean(outcome)) {
        throw endedBadly(file, outcome);
    }
    return outputOf(outcome.stdout, given);
}

// What `spawnSync` hands back.
interface SpawnSyncAnswer {
    pid: number;
    output: (string | Buffer | null)[];
    stdout: string | Buffer;
    stderr: string | Buffer;
    status: number | null;
    signal: string | null;
    error?: Error;
}

export function spawnSync(command: string, args?: unknown, options?: unknown): SpawnSyncAnswer {
    if (nowRunning() === undefined) {
        return (realChild.spawnSync as (...given: unknown[]) => SpawnSyncAnswer)(command, args, options);
    }
    const given = optionsIn([args, options]);
    const outcome = outcomeFor(command, given, typeof given.maxBuffer === "number");
    const stdout = outputOf(outcome.stdout, given);
    const stderr = outputOf(outcome.stderr, given);
    const answer: SpawnSyncAnswer = {
        pid: 0,
        output: [null, stdout, stderr],
        stdout,
        stderr,
        status: outcome.code,
        signal: outcome.signal,
    };
    if (outcome.error !== undefined) {
        answer.error = outcome.error;
    }
    if (outcome.pastLimit) {
        answer.error = endedBadly(command, outcome);
    }
    if (outcome.timedOut) {
        answer.error = Object.assign(new Error(`spawnSync ${command} ETIMEDOUT`), {
            code: "ETIMEDOUT",
        });
    }
    return answer;
}

// Calls `done` once a started program's stream has been read to its end, or has failed. A stream
// no one reads holds nothing up, because a program's close is not held back by output no one asked
// for, so `done` is called straight after the turn.
export function whenDrained(stream: Readable, done: () => void): void {
    if (stream.listenerCount("data") === 0 && stream.listenerCount("readable") === 0 && stream.readableFlowing !== true) {
        queueMicrotask(done);
        return;
    }
    finished(stream, {
        writable: false,
    }, () => {
        done();
    });
}

// One started program, as `node:child_process` hands it back. Its output and error streams end
// with no data, and it ends as its outcome says.
class ChildProcess extends EventEmitter {
    // What the program reads.
    readonly stdin: Writable;

    // What it printed on its output stream.
    readonly stdout: Readable;

    // What it printed on its error stream.
    readonly stderr: Readable;

    // The number the program would run as. No program runs, so it has none.
    readonly pid: number | undefined;

    // The code it exited with, once it has.
    exitCode: number | null = null;

    // The signal that ended it, once one has.
    signalCode: string | null = null;

    // Whether `kill` was called.
    killed = false;

    constructor(outcome: Outcome) {
        super();
        this.stdin = new PassThrough();
        this.stdout = Readable.from(outcome.stdout === "" ? [] : [Buffer.from(outcome.stdout)]);
        this.stderr = Readable.from(outcome.stderr === "" ? [] : [Buffer.from(outcome.stderr)]);
        this.pid = outcome.error === undefined ? 0 : undefined;
        queueMicrotask(() => {
            if (outcome.error !== undefined) {
                this.emit("error", outcome.error);
                this.emit("close", -2, null);
                return;
            }
            this.emit("spawn");
            this.exitCode = outcome.code;
            this.signalCode = outcome.signal;
            this.emit("exit", outcome.code, outcome.signal);
            //
            // Node says a program closed once its output and error streams have, so code that
            // reads what it printed and waits for `close` has all of it by then.
            //
            let open = 2;
            const closeOne = (): void => {
                open -= 1;
                if (open === 0) {
                    this.emit("close", outcome.code, outcome.signal);
                }
            };
            whenDrained(this.stdout, closeOne);
            whenDrained(this.stderr, closeOne);
        });
    }

    // Stops the program, which stops none because none was started.
    kill(): boolean {
        this.killed = true;
        return true;
    }

    ref(): void {
        // No program is running, so there is none to keep the process alive for.
    }

    unref(): void {
        // No program is running, so there is none to let go of.
    }

    disconnect(): void {
        // No channel was opened.
    }

    // Sends a message to a program that is not there. It is taken, as a channel that is open takes
    // it, and no answer comes back.
    send(): boolean {
        return true;
    }
}

export function spawn(command: string, args?: unknown, options?: unknown): ChildProcess {
    if (nowRunning() === undefined) {
        return (realChild.spawn as (...given: unknown[]) => unknown)(command, args, options) as unknown as ChildProcess;
    }
    return new ChildProcess(outcomeFor(command, optionsIn([args, options]), false));
}

export function fork(module: string, args?: unknown, options?: unknown): ChildProcess {
    if (nowRunning() === undefined) {
        return (realChild.fork as (...given: unknown[]) => unknown)(module, args, options) as unknown as ChildProcess;
    }
    return new ChildProcess(outcomeFor(module, optionsIn([args, options]), false));
}

// Starts a program and hands what it printed to a callback, as `exec` and `execFile` do.
function execWith(command: string, args: unknown[], realCall: (...given: unknown[]) => unknown): ChildProcess {
    if (nowRunning() === undefined) {
        return realCall(command, ...args) as ChildProcess;
    }
    const done = args.find((one) => typeof one === "function") as ((error: unknown, out: string, err: string) => void) | undefined;
    const outcome = outcomeFor(command, optionsIn(args), true);
    const child = new ChildProcess(outcome);
    if (done !== undefined) {
        // Node's `exec` listens for the program failing to start and hands that error to the
        // callback, so the error event has a listener and the callback reports it.
        child.on("error", () => undefined);
        queueMicrotask(() => {
            if (outcome.error !== undefined) {
                done(outcome.error, "", "");
                return;
            }
            done(isClean(outcome) ? null : endedBadly(command, outcome), outcome.stdout, outcome.stderr);
        });
    }
    return child;
}

export function exec(command: string, ...args: unknown[]): ChildProcess {
    return execWith(command, args, realChild.exec as (...given: unknown[]) => unknown);
}

export function execFile(file: string, ...args: unknown[]): ChildProcess {
    return execWith(file, args, realChild.execFile as (...given: unknown[]) => unknown);
}

// What `util.promisify` makes of `exec` and `execFile`: a promise of what the program printed,
// as Node's own promise form gives it.
function promiseOfOutput(call: (command: string, ...args: unknown[]) => ChildProcess, realCall: (...given: unknown[]) => unknown): (command: string, ...args: unknown[]) => Promise<{ stdout: string; stderr: string }> {
    const realPromised = promisify(realCall) as (...given: unknown[]) => Promise<{ stdout: string; stderr: string }>;
    return (command: string, ...args: unknown[]): Promise<{ stdout: string; stderr: string }> => {
        if (nowRunning() === undefined) {
            return realPromised(command, ...args);
        }
        return new Promise((settle, refuse) => {
            call(command, ...args, (error: Error | null, stdout: string, stderr: string) => {
                if (error !== null) {
                    refuse(Object.assign(error, {
                        stdout,
                        stderr,
                    }));
                    return;
                }
                settle({
                    stdout,
                    stderr,
                });
            });
        });
    };
}

Object.defineProperty(exec, promisify.custom, {
    value: promiseOfOutput(exec, realChild.exec as (...given: unknown[]) => unknown),
});

Object.defineProperty(execFile, promisify.custom, {
    value: promiseOfOutput(execFile, realChild.execFile as (...given: unknown[]) => unknown),
});

export { ChildProcess };

// What `import child from "node:child_process"` gets.
export default {
    ...realChild,
    exec,
    execFile,
    execSync,
    execFileSync,
    fork,
    spawn,
    spawnSync,
    ChildProcess,
};
