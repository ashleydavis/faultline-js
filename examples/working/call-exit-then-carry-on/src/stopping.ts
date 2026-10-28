//
// A function that calls `process.exit`, followed by one that does not.
//

import assert from "node:assert/strict";

//
// Ends the program when a count is negative.
//
export function stopWhenNegative(count: number): number {
    assert(typeof count === "number");
    if (count < 0) {
        process.exit(2);
    }
    return count;
}

//
// Says whether a count is large.
//
export function countSize(count: number): string {
    assert(typeof count === "number");
    if (count > 100) {
        return "large";
    }
    return "small";
}
