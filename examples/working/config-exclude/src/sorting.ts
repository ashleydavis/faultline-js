//
// The code this example fault tests.
//

import assert from "node:assert/strict";

//
// Gives the largest of the values, or minus infinity for an empty list.
//
export function highest(values: number[]): number {
    assert(Array.isArray(values));
    let best = Number.NEGATIVE_INFINITY;
    for (const value of values) {
        if (value > best) {
            best = value;
        }
    }
    assert(typeof best === "number");
    return best;
}
