//
// The other directory the run tests.
//

import assert from "node:assert/strict";

//
// Counts the even values.
//
export function evens(values: number[]): number {
    assert(Array.isArray(values));
    let found = 0;
    for (const value of values) {
        if (value % 2 === 0) {
            found += 1;
        }
    }
    assert(found <= values.length);
    return found;
}
