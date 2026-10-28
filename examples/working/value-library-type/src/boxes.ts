//
// A function taking a library type, which Faultline builds only from a value factory.
//

import assert from "node:assert/strict";
import type { Box } from "./box.d.ts";

//
// Says whether a box holds a large number.
//
export function boxSize(box: Box<number>): string {
    assert(typeof box.value === "number");
    if (box.value > 10) {
        return "large";
    }
    return "small";
}
