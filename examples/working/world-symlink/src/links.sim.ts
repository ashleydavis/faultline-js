//
// A target for the link to lead to, which the simulated filesystem does not start with.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { ScenarioContext } from "faultline";
import { follow } from "./links.ts";

//
// Writes the target and reads it through the link.
//
export async function linkToAFile(context: ScenarioContext): Promise<void> {
    await fs.writeFile("/target", "what the link leads to");
    const read = await follow();
    assert(typeof read === "string");
    context.expect(read === "what the link leads to", "Reading through the link reads the target.");
}
