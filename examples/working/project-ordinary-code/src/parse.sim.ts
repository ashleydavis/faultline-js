//
// The settings files a run has to write before the reader can read them: one that parses and one
// that does not.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { ScenarioContext } from "faultline";
import { readSettings } from "./parse.ts";

//
// A file that names its retries and one that names only whether to say more.
//
export async function settingsThatParse(context: ScenarioContext): Promise<void> {
    await fs.writeFile("/retries.json", JSON.stringify({
        retries: 5,
    }));
    const named = await readSettings("/retries.json");
    assert(typeof named.retries === "number");
    context.expect(named.retries === 5, "The retries the file names are used.");
    context.expect(!named.verbose, "A file that does not say gives quiet settings.");
    await fs.writeFile("/verbose.json", JSON.stringify({
        verbose: true,
    }));
    const defaulted = await readSettings("/verbose.json");
    assert(typeof defaulted.retries === "number");
    context.expect(defaulted.retries === 3, "A file that names no retries gives the default of 3.");
    context.expect(defaulted.verbose, "A file that asks to say more gets it.");
}

//
// A file that is not JSON.
//
export async function settingsThatDoNotParse(context: ScenarioContext): Promise<void> {
    await fs.writeFile("/broken.json", "retries: five");
    const settings = await readSettings("/broken.json");
    assert(typeof settings.retries === "number");
    context.expect(settings.retries === 0, "A file that is not JSON gives no retries.");
}
