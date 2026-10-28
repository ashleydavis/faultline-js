//
// Checks that `flt`, started as a process of its own, refuses a runtime that cannot run Faultline
// in one sentence and exits 1: a Node older than the one `engines.node` names, and Bun.
//
// The older Node is the Node running this check with its version read as 22.22.2, set by
// `src/smoke/older-node.ts` before `flt` starts. Bun is the Bun the project pins.
//

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

//
// What one run of `flt` wrote on its error stream and exited with.
//
export interface IFltRun {
    //
    // What it wrote to standard error.
    //
    stderr: string;

    //
    // What it exited with, or undefined when a signal ended it.
    //
    exitCode: number | undefined;
}

//
// Runs `program` with `programArguments` and waits for it to end. A program that cannot be started
// fails the check with the reason. Exiting with a code other than 0 is what the check looks for,
// so it is an answer and not a failure.
//
export function runProgram(program: string, programArguments: string[]): Promise<IFltRun> {
    assert(program.length > 0);
    assert(programArguments.length > 0);
    return new Promise((resolve, reject) => {
        const child = execFile(program, programArguments, {
            encoding: "utf8",
        }, (error, _stdout, stderr) => {
            if (error) {
                if (typeof error.code === "string") {
                    reject(new Error(`${program} could not be started: ${error.message}.`));
                    return;
                }
            }
            resolve({
                stderr,
                exitCode: child.exitCode ?? undefined,
            });
        });
    });
}

//
// Starts `flt` under the older Node and under Bun and checks both refusals.
//
export async function main(): Promise<void> {
    const flt = path.resolve(import.meta.dirname, "../bin/flt.ts");
    const older = pathToFileURL(path.resolve(import.meta.dirname, "older-node.ts")).href;
    const underOlderNode = await runProgram(process.execPath, ["--import", older, flt]);
    assert.deepEqual(underOlderNode, {
        stderr: "Faultline needs Node 24.0.0 or later and this is Node 22.22.2, so install Node 24 or later and run it again.\n",
        exitCode: 1,
    });
    const underBun = await runProgram("bun", [flt]);
    assert.match(underBun.stderr, /^Faultline needs Node 24\.0\.0 or later and this is Bun \d+\.\d+\.\d+, so start `flt` with Node\.\n$/);
    assert.equal(underBun.exitCode, 1);
    process.stdout.write("flt refuses an older Node and Bun in one sentence and exits 1.\n");
}

await main();
