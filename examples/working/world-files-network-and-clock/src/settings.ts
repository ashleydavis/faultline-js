//
// Code that reads a file, fetches over the network, waits and writes, with none of it written for
// Faultline.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";

//
// What a settings file holds.
//
export interface ISettings {
    //
    // How many times to try again after a failure, when the file says.
    //
    retries?: number;
}

//
// Gives how many retries the settings file asks for, 1 when it does not say and 0 when it cannot be
// read or is not JSON.
//
export async function retriesFrom(path: string): Promise<number> {
    assert(typeof path === "string");
    try {
        const settings: ISettings = JSON.parse(await fs.readFile(path, "utf8"));
        return settings.retries ?? 1;
    }
    catch {
        return 0;
    }
}

//
// Says whether a service answers its health check.
//
export async function isUp(): Promise<boolean> {
    try {
        const response = await fetch("https://example.com/health");
        assert(typeof response.ok === "boolean");
        return response.ok;
    }
    catch {
        return false;
    }
}

//
// Waits for a number of milliseconds and gives how long the clock says it waited.
//
export async function waited(milliseconds: number): Promise<number> {
    assert(typeof milliseconds === "number");
    const before = Date.now();
    await new Promise<void>((settle) => {
        setTimeout(settle, milliseconds);
    });
    return Date.now() - before;
}

//
// Adds a line to a log file and says whether the file now ends with it.
//
export async function writeLine(text: string): Promise<boolean> {
    assert(typeof text === "string");
    try {
        await fs.appendFile("/log.txt", `${text}\n`);
        const written = await fs.readFile("/log.txt", "utf8");
        return written.endsWith(`${text}\n`);
    }
    catch {
        return false;
    }
}
