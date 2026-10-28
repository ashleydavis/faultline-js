//
// One of the two directories the run tests.
//

import assert from "node:assert/strict";

//
// Gives the text in capitals with an exclamation mark, or the empty text as it is.
//
export function shout(text: string): string {
    assert(typeof text === "string");
    if (text === "") {
        return "";
    }
    return `${text.toUpperCase()}!`;
}
