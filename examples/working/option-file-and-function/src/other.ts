//
// A file the run leaves out, because the run is narrowed to the file beside it.
//

import assert from "node:assert/strict";

//
// Says whether the text is the one word this file looks for.
//
export function isTheWord(text: string): boolean {
    assert(typeof text === "string");
    if (text === "the one value no boundary value is") {
        return true;
    }
    return false;
}
