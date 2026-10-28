//
// The file with a function to exercise.
//

import assert from "node:assert/strict";
import { BIGGEST_SIDE, type IMeasurement } from "./shapes.ts";

//
// Says whether a picture fits inside the largest size allowed.
//
export function fits(measurement: IMeasurement): boolean {
    const longest = Math.max(measurement.width, measurement.height);
    assert(typeof longest === "number");
    if (longest > BIGGEST_SIDE) {
        return false;
    }
    return true;
}
