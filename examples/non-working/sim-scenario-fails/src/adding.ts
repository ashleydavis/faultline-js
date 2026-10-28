//
// The code the scenario beside it disagrees with.
//

import assert from "node:assert/strict";

//
// Gives the value plus one.
//
export function addOne(value: number): number {
    assert(typeof value === "number");
    const sum = value + 1;
    assert(typeof sum === "number");
    return sum;
}
