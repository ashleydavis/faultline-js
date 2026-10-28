//
// A file the narrowed run leaves out.
//

import assert from "node:assert/strict";

//
// Whether a number is even. No value Faultline picks for this file is run, because the run is
// narrowed to the other file.
//
export function isEven(value: number): boolean {
    assert(typeof value === "number");
    if (value % 2 === 0) {
        return true;
    }
    return false;
}
