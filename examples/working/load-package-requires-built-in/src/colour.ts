//
// The colour the program draws in, from its settings file.
//

import assert from "node:assert/strict";
import { readSettings } from "legacy-settings";

//
// Where the settings file is.
//
export const settingsFile = "/etc/legacy-example/colour";

//
// The colour the settings file names, or "black" when there is no settings file.
//
export function readColour(): string {
    const settings = readSettings(settingsFile);
    assert(settings === null || typeof settings === "string");
    if (settings === null) {
        return "black";
    }
    return settings.trim();
}
