//
// Making a symlink and reading through it.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";

//
// Makes a link at `/link` to `/target` and gives what reading through it found.
//
export async function follow(): Promise<string> {
    try {
        await fs.symlink("/target", "/link");
    }
    catch {
        return "The link could not be made.";
    }
    const target = await fs.readlink("/link");
    assert(target === "/target");
    try {
        return await fs.readFile("/link", "utf8");
    }
    catch {
        return "The link leads nowhere.";
    }
}
