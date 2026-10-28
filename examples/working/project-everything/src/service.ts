//
// Code that reaches the outside world and declares none of it: the clock, the filesystem, the
// network, another program, a name lookup, random numbers and standard output.
//

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs/promises";

//
// What a health check found.
//
export interface IHealth {
    //
    // Whether the service answered.
    //
    up: boolean;

    //
    // How long the check took.
    //
    tookMs: number;
}

//
// What a settings file may say.
//
export interface IWrittenSettings {
    //
    // How many times to try again after a failure, when the file says.
    //
    retries?: number;
}

//
// Gives how many retries the settings ask for, 1 when they do not say and 0 when they cannot be
// read or are not JSON.
//
export async function retriesFrom(path: string): Promise<number> {
    assert(typeof path === "string");
    try {
        const settings: IWrittenSettings = JSON.parse(await fs.readFile(path, "utf8"));
        return settings.retries ?? 1;
    }
    catch {
        return 0;
    }
}

//
// Writes the lines of a report and gives how many characters were written, or 0 when the write
// failed.
//
export async function writeReport(path: string, lines: string[]): Promise<number> {
    assert(Array.isArray(lines));
    const text = `${lines.join("\n")}\n`;
    try {
        await fs.writeFile(path, text);
        return text.length;
    }
    catch {
        return 0;
    }
}

//
// Asks a service whether it is up and times the asking.
//
export async function checkHealth(where: string): Promise<IHealth> {
    assert(typeof where === "string");
    const began = Date.now();
    try {
        const answer = await fetch("https://example.com/health");
        return {
            up: answer.ok,
            tookMs: Date.now() - began,
        };
    }
    catch {
        return {
            up: false,
            tookMs: Date.now() - began,
        };
    }
}

//
// Looks a name up, giving undefined when it cannot be found.
//
export async function addressOf(name: string): Promise<string | undefined> {
    assert(typeof name === "string");
    try {
        const found = await dns.lookup("example.com");
        return found.address;
    }
    catch {
        return undefined;
    }
}

//
// Runs another program and says whether it succeeded, or gives undefined when it would not start.
//
export async function isSuccessOf(program: string, argument: string): Promise<boolean | undefined> {
    assert(typeof program === "string");
    assert(typeof argument === "string");
    return new Promise((settle) => {
        const child = spawn("ls", [argument]);
        child.on("error", () => {
            settle(undefined);
        });
        child.on("close", (code) => {
            settle(code === 0);
        });
    });
}

//
// Gives a name a person cannot guess, so one run's report is told apart from another's.
//
export function reportName(): string {
    const name = `report-${String(Math.floor(Math.random() * 1000))}`;
    assert(name.startsWith("report-"));
    return name;
}

//
// Waits and gives how long the clock says it waited.
//
export async function waitThen(milliseconds: number): Promise<number> {
    assert(typeof milliseconds === "number");
    const began = Date.now();
    await new Promise<void>((settle) => {
        setTimeout(settle, milliseconds);
    });
    return Date.now() - began;
}

//
// Writes one line to standard output. A write that fails emits an error on the stream as well as
// handing it to the write's callback, so the stream is listened to until the write has gone
// through, and a failed write is noted rather than left for no code to catch.
//
export function printLine(line: string): void {
    assert(typeof line === "string");
    process.stdout.once("error", noteWriteFailure);
    process.stdout.write(`${line}\n`, (error?: Error | null) => {
        if (!error) {
            process.stdout.off("error", noteWriteFailure);
        }
    });
}

//
// Takes the error a failed write to standard output emits, which the line it was writing is lost
// to.
//
export function noteWriteFailure(error: Error): void {
    assert(error instanceof Error);
    assert(typeof error.message === "string");
}
