//
// Saving a note to the one file notes go in.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";

//
// Where a note is saved.
//
export const NOTE_PATH = "/note.txt";

//
// Saves a note, giving false when it could not be written.
//
export async function save(note: string): Promise<boolean> {
    assert(typeof note === "string");
    try {
        await fs.writeFile(NOTE_PATH, note);
        return true;
    }
    catch {
        return false;
    }
}
