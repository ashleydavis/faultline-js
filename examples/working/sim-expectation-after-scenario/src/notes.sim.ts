//
// A scenario that saves a note, and the expectation that runs after it and after every call.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { ExpectationContext, ScenarioContext } from "faultline";
import { NOTE_PATH, save } from "./notes.ts";

//
// Saves a note and expects it to be there.
//
export async function savingLeavesTheNote(context: ScenarioContext): Promise<void> {
    const saved = await save("remember the milk");
    assert(typeof saved === "boolean");
    context.expect(saved, "A note that was saved says so.");
}

//
// Saving never leaves any file but the note behind.
//
export async function onlyTheNoteExists(context: ExpectationContext): Promise<void> {
    const names = await fs.readdir("/");
    assert(Array.isArray(names));
    context.expect(names.every((name) => `/${name}` === NOTE_PATH), "The note is the only file.");
}
