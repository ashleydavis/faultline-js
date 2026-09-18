// The invariant the code above breaks.

import { left } from "./counter.ts";

export function theCountIsNeverNegative(): void {
    if (left() < 0) {
        throw new Error("TheCountWentNegative");
    }
}
