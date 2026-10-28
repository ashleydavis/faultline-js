//
// A file the run never reads, because it refuses the option first.
//

import assert from "node:assert/strict";

//
// Gives the value it is given.
//
export function plain(value: number): number {
    assert(typeof value === "number");
    return value;
}
