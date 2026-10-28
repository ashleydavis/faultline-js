//
// A branch per word, each reached by the word the condition names.
//

import assert from "node:assert/strict";

//
// Gives what a status word means.
//
export function meaningOf(word: string): string {
    assert(typeof word === "string");
    if (word === "ok") {
        return "Everything is fine.";
    }
    if (word === "warn") {
        return "Something may go wrong.";
    }
    if (word === "fail") {
        return "Something went wrong.";
    }
    return "The word is not a status.";
}
