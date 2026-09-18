// Reading a settings file, which is what most code does with the file system.

import fs from "node:fs/promises";

export interface Settings {
    retries: number;
    verbose: boolean;
}

export async function readSettings(path: string): Promise<Settings> {
    try {
        const held = JSON.parse(await fs.readFile(path, "utf8")) as Partial<Settings>;
        return { retries: held.retries ?? 3, verbose: held.verbose === true };
    }
    catch (thrown) {
        if ((thrown as { code?: string }).code === "ENOENT") {
            return { retries: 3, verbose: false };
        }
        if (thrown instanceof SyntaxError) {
            return { retries: 0, verbose: true };
        }
        throw thrown;
    }
}

export function nameOf(held: { profile?: { name?: string } } | null): string {
    return held?.profile?.name ?? "anonymous";
}
