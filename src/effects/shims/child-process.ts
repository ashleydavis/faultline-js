// What the copy imports in place of `node:child_process`.
//
// No program is started. A call answers the way a program that ran and printed something answers,
// until the injector says this one goes wrong, and then it fails the way a real one fails: the
// program is not there, it will not start, it ends with a status nobody checked, or it writes to
// the error stream and carries on.

import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { nowRunning } from "../current.ts";
import { CodedError } from "../effects.ts";

// Everything the real module has and this one does not replace. A name a project imports and this
// file does not hand out would stop the import outright, and a name declared here wins over the
// one the star brings in.
export * from "node:child_process";

// What a program that worked printed. It is a line, because that is what code under test reads and
// trims.
const printed = "ok\n";

// What a program that went wrong printed on the error stream.
const complained = "something went wrong\n";

// How one call goes. The status is what the program ended with and the error is what starting it
// threw, and only one of the two is ever set.
interface Outcome {
    // What starting the program threw, when it would not start.
    error?: Error;

    // What it printed on the output stream.
    out: string;

    // What it printed on the error stream.
    err: string;

    // What it ended with. Zero is the program working.
    status: number;
}

// What the injector made of this call.
function outcomeFor(command: string): Outcome {
    const failure = nowRunning()?.injector.check("process");
    if (failure === "missing") {
        return { error: new CodedError("ENOENT", `spawn ${command} ENOENT`), out: "", err: "", status: -1 };
    }
    if (failure === "denied") {
        return { error: new CodedError("EACCES", `spawn ${command} EACCES`), out: "", err: "", status: -1 };
    }
    if (failure === "failed") {
        return { out: "", err: complained, status: 1 };
    }
    if (failure === "on-error-stream") {
        return { out: printed, err: complained, status: 0 };
    }
    return { out: printed, err: "", status: 0 };
}

// The error `execSync` and the `exec` callback carry for a program that ended badly.
function endedBadly(command: string, outcome: Outcome): Error & { status: number; stdout: string; stderr: string } {
    const thrown = new Error(`Command failed: ${command}\n${outcome.err}`) as Error & {
        status: number;
        stdout: string;
        stderr: string;
    };
    thrown.status = outcome.status;
    thrown.stdout = outcome.out;
    thrown.stderr = outcome.err;
    return thrown;
}

export function execSync(command: string): string | Buffer {
    const outcome = outcomeFor(command);
    if (outcome.error !== undefined) {
        throw outcome.error;
    }
    if (outcome.status !== 0) {
        throw endedBadly(command, outcome);
    }
    return outcome.out;
}

export function execFileSync(file: string): string | Buffer {
    return execSync(file);
}

export function exec(command: string, options?: unknown, callback?: unknown): ChildProcess {
    const done = (typeof options === "function" ? options : callback) as
        | ((error: unknown, out?: string, err?: string) => void)
        | undefined;
    const outcome = outcomeFor(command);
    const child = new ChildProcess(outcome);
    queueMicrotask(() => {
        // A caller that passed something other than a function where the callback goes gets no
        // answer, the same as one that passed none.
        if (typeof done !== "function") {
            return;
        }
        if (outcome.error !== undefined) {
            done(outcome.error, "", "");
            return;
        }
        if (outcome.status !== 0) {
            done(endedBadly(command, outcome), outcome.out, outcome.err);
            return;
        }
        done(null, outcome.out, outcome.err);
    });
    return child;
}

export function execFile(file: string, options?: unknown, callback?: unknown): ChildProcess {
    return exec(file, options, callback);
}

// One started program, as `node:child_process` hands it back. Both its streams are there and both
// end, so a caller that reads either gets past it.
class ChildProcess extends EventEmitter {
    // What the program printed on its output stream.
    readonly stdout: Readable;

    // What it printed on its error stream.
    readonly stderr: Readable;

    // What it ended with, once it has.
    readonly exitCode: number;

    constructor(outcome: Outcome) {
        super();
        this.stdout = Readable.from([outcome.out]);
        this.stderr = Readable.from([outcome.err]);
        this.exitCode = outcome.status;
        queueMicrotask(() => {
            if (outcome.error !== undefined) {
                this.emit("error", outcome.error);
                return;
            }
            this.emit("exit", outcome.status, null);
            this.emit("close", outcome.status, null);
        });
    }

    // Stops the program, which stops nothing because none was started.
    kill(): boolean {
        return true;
    }
}

export function spawn(command: string): ChildProcess {
    return new ChildProcess(outcomeFor(command));
}

export function spawnSync(command: string): { status: number; stdout: string; stderr: string; error?: Error } {
    const outcome = outcomeFor(command);
    return { status: outcome.status, stdout: outcome.out, stderr: outcome.err, error: outcome.error };
}

export { ChildProcess };

// What `import child from "node:child_process"` gets.
export default { exec, execFile, execSync, execFileSync, spawn, spawnSync, ChildProcess };
