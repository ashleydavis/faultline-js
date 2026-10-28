//
// One of several files, so the workers have files to share.
//

import assert from "node:assert/strict";

//
// Says whether a value is above the limit this file holds to.
//
export function thirdIsAbove(value: number): boolean {
    assert(typeof value === "number");
    if (value > 10) {
        return true;
    }
    return false;
}
