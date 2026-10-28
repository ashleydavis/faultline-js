//
// Both sides of an `if`, and an `if` whose false side is not written out.
//

import assert from "node:assert/strict";

//
// Says whether there are any, with both sides of the `if` written out.
//
export function classify(count: number): string {
    assert(typeof count === "number");
    if (count === 0) {
        return "none";
    }
    else {
        return "some";
    }
}

//
// Doubles a small value. The `if` has no `else`, and its false side is still a code path.
//
export function doubleWhenSmall(value: number): number {
    assert(typeof value === "number");
    if (value < 100) {
        return value * 2;
    }
    return value;
}

//
// Names the band a value falls in. Each arm of the chain is the false side of the one above it.
//
export function band(value: number): string {
    assert(typeof value === "number");
    if (value < 0) {
        return "under";
    }
    else {
        if (value < 10) {
            return "low";
        }
    }
    return "high";
}
