// Code that reads a file, fetches over the network, waits and writes, with none of it written for
// the tool.
//
// Every one of these is replaced underneath the run, so the paths that only run when something goes
// wrong are reached without a scenario.

import fs from "node:fs/promises";

// Reads how many retries the settings ask for, or falls back when they say nothing.
export async function retriesFrom(path: string): Promise<number> {
    try {
        const held = JSON.parse(await fs.readFile(path, "utf8")) as { retries?: number };
        return held.retries ?? 1;
    }
    catch {
        return 0;
    }
}

// Asks a service whether it is up.
export async function isUp(): Promise<boolean> {
    try {
        return (await fetch("https://example.com/health")).ok;
    }
    catch {
        return false;
    }
}

// Waits, then says how long it waited for. A run returns at once and moves its own clock instead.
export async function waited(milliseconds: number): Promise<number> {
    const before = Date.now();
    await new Promise<void>((settle) => setTimeout(settle, milliseconds));
    return Date.now() - before;
}

// Writes a line to a log, and says whether it is all there.
export async function writeLine(text: string): Promise<boolean> {
    await fs.appendFile("/log.txt", `${text}\n`);
    return (await fs.readFile("/log.txt", "utf8")).endsWith(`${text}\n`);
}
