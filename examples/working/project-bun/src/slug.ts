//
// Turning a title into the part of a URL that names it.
//

import assert from "node:assert/strict";

//
// Gives a title in lower case with every run of other characters turned into one hyphen, or
// "untitled" for a title with no letters or digits.
//
export function slugify(text: string): string {
    const trimmed = text.trim().toLowerCase();
    assert(typeof trimmed === "string");
    if (trimmed === "") {
        return "untitled";
    }
    return trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
