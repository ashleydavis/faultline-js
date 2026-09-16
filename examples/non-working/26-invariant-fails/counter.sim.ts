// The invariant the code above breaks.

import type { Subject } from "faultline";
import { left } from "./counter.ts";

export function theCountIsNeverNegative(self: Subject): void {
    void self;

    if (left() < 0) {
        throw new Error("TheCountWentNegative");
    }
}
