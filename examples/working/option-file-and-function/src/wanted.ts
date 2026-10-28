//
// The file the run is narrowed to, holding the one function it is narrowed to and one it is not.
//

import assert from "node:assert/strict";

//
// Says whether a value is above zero. The run is narrowed to this function.
//
export function wanted(value: number): string {
    assert(typeof value === "number");
    if (value > 0) {
        return "positive";
    }
    return "not positive";
}

//
// Caps a value at one hundred. The run leaves it out, because it is narrowed to the function above.
//
export function capped(value: number): number {
    assert(typeof value === "number");
    if (value > 100) {
        return 100;
    }
    return value;
}
