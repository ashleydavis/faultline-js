//
// The settings file laid out in the run's filesystem, which the package reads through `require`.
//

import type { ScenarioContext } from "faultline";
import { mkdirSync, writeFileSync } from "node:fs";
import { readColour, settingsFile } from "./colour.ts";

//
// Writes a settings file naming a colour and reads the colour back.
//
export function readWrittenColour(context: ScenarioContext): void {
    mkdirSync("/etc/legacy-example", {
        recursive: true,
    });
    writeFileSync(settingsFile, "teal\n");
    const colour = readColour();
    context.expect(colour === "teal", "the colour the settings file names");
}
