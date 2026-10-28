//
// The expectation the counter breaks.
//

import assert from "node:assert/strict";
import type { ExpectationContext } from "faultline";
import { theCounter } from "./counter.ts";

//
// The count never goes below zero, whatever was called.
//
export function countIsNeverNegative(context: ExpectationContext): void {
    const left = theCounter.left;
    assert(typeof left === "number");
    context.expect(!(left < 0), "The count never goes below zero.");
}
