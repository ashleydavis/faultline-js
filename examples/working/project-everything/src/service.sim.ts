//
// The settings files the reader needs. The simulated filesystem starts empty, so the scenario writes
// them first. Faultline injects every other failure the service can meet without being asked.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { ScenarioContext } from "faultline";
import { retriesFrom } from "./service.ts";

//
// Settings that name their retries and settings that do not.
//
export async function everyWayTheSettingsGo(context: ScenarioContext): Promise<void> {
    await fs.writeFile("/settings.json", JSON.stringify({
        retries: 3,
    }));
    const named = await retriesFrom("/settings.json");
    assert(typeof named === "number");
    context.expect(named === 3, "The retries the file names are used.");
    await fs.writeFile("/quiet.json", "{}");
    context.expect(await retriesFrom("/quiet.json") === 1, "A file that names no retries gives the default of 1.");
}
