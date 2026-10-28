//
// A file the run never calls, because the token cannot be read.
//

import assert from "node:assert/strict";

//
// Gives the value it is given.
//
export function plain(value: number): number {
    assert(typeof value === "number");
    return value;
}
