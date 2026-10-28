//
// The mode set before the file is imported, which only a fresh import of the file reads.
//

import assert from "node:assert/strict";
import type { ScenarioContext } from "faultline";

//
// Sets `MODE` and imports the file afresh, so its top level reads the mode.
//
export async function modeSetBeforeImport(context: ScenarioContext): Promise<void> {
    process.env.MODE = "development";
    const loaded = await context.load("src/mode.ts");
    assert(typeof loaded === "object");
    context.expect(loaded.MODE === "development", "The mode set before the import is the mode used.");
}
