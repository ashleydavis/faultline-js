//
// The two code paths that need a settings file to exist: one that names the retries and one that
// does not. The simulated filesystem starts empty, so each scenario writes its file first.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { ScenarioContext } from "faultline";
import { retriesFrom } from "./settings.ts";

//
// Settings that name no retries, so the default is used.
//
export async function settingsWithNoRetries(context: ScenarioContext): Promise<void> {
    await fs.writeFile("/quiet.json", "{}");
    const retries = await retriesFrom("/quiet.json");
    assert(typeof retries === "number");
    context.expect(retries === 1, "Settings that name no retries give the default of 1.");
}

//
// Settings that say how many retries to use.
//
export async function settingsWithRetries(context: ScenarioContext): Promise<void> {
    await fs.writeFile("/settings.json", JSON.stringify({
        retries: 3,
    }));
    const retries = await retriesFrom("/settings.json");
    assert(typeof retries === "number");
    context.expect(retries === 3, "Settings that name 3 retries give 3.");
}
