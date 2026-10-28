//
// Whether an amount is within the limit a JSON file sets, imported as Bun imports it.
//

import assert from "node:assert/strict";
import limits from "./limits.json";

//
// Whether `amount` is no more than the largest amount the JSON file allows.
//
export function isWithinLimit(amount: number): boolean {
    assert(typeof amount === "number");
    assert(limits.largest > 0);
    if (amount <= limits.largest) {
        return true;
    }
    return false;
}
