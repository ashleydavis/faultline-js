// Every effect a run supplies, taken as a parameter.
//
// A function that takes one of these is handed the run's own, which answers and fails in turn, so
// the paths that only run when something goes wrong are reached without a scenario.

import type { Clock, Files, Net, Writer } from "faultline";

// Reads how many retries the settings ask for, or falls back when they say nothing.
export async function retriesFrom(files: Files, path: string): Promise<number> {
    try {
        const held = JSON.parse(await files.read(path)) as { retries?: number };
        return held.retries ?? 1;
    }
    catch {
        return 0;
    }
}

// Asks a service whether it is up.
export async function isUp(net: Net): Promise<boolean> {
    try {
        return (await net.fetch("https://example.com/health")).ok;
    }
    catch {
        return false;
    }
}

// Waits, then says how long it waited for. A run returns at once and moves its own clock instead.
export async function waited(clock: Clock, milliseconds: number): Promise<number> {
    const before = clock.monotonic();
    await clock.sleep(milliseconds);
    return clock.monotonic() - before;
}

// Writes a line, and says whether all of it went out.
export async function writeLine(writer: Writer, text: string): Promise<boolean> {
    const took = await writer.write(`${text}\n`);
    if (took < text.length + 1) {
        return false;
    }
    return true;
}
