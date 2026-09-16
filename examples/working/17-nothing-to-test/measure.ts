// The file with something in it to exercise.

import { biggest, type Measurement } from "./shapes.ts";

export function fits(measurement: Measurement): boolean {
    if (measurement.width > biggest) {
        return false;
    }
    if (measurement.height > biggest) {
        return false;
    }
    return true;
}
