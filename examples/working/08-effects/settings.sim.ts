// The two paths no made up call reaches: settings that say how many retries to use, and settings
// that parse and say nothing about them.
//
// A made up path is never the one the run's own file system already holds, so neither side of the
// fallback is reached without these.

import fs from "node:fs/promises";
import type { Checklist, Injector } from "faultline";
import { retriesFrom } from "./settings.ts";

// Settings that say nothing about retries, so the fallback is used.
export async function settingsWithNoRetries(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    await fs.writeFile("/quiet.json", "{}");
    if ((await retriesFrom("/quiet.json")) !== 1) {
        throw new Error("TheFallbackWasNotUsed");
    }
}

// Settings that say how many retries to use, so the fallback is skipped.
export async function settingsWithRetries(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    if ((await retriesFrom("/settings.json")) !== 3) {
        throw new Error("TheSettingsWereNotRead");
    }
}
