//
// A branch that turns on a value worked out while the code runs, which no condition names.
//

import assert from "node:assert/strict";

//
// Says whether a word is magic, which no word is, because a word is never seven characters longer
// than its own list of characters.
//
export function isMagic(word: string): boolean {
    assert(typeof word === "string");
    if (word.length === word.split("").length + 7) {
        return true;
    }
    return false;
}
