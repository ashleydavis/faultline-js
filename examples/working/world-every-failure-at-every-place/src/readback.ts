//
// Writing a file and reading it back, with a branch for each step failing.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";

//
// Writes the text to a file and reads it back, and says which step failed when one did.
//
export async function saveAndReadBack(text: string): Promise<string> {
    assert(typeof text === "string");
    try {
        await fs.writeFile("/saved.txt", text);
    }
    catch {
        return "The file could not be written.";
    }
    try {
        const read = await fs.readFile("/saved.txt", "utf8");
        assert(typeof read === "string");
        return `Saved ${String(read.length)} characters.`;
    }
    catch {
        return "The file could not be read back.";
    }
}
