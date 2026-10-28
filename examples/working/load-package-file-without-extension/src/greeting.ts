//
// Greets a person by the part of the day, through a package's file imported with no extension.
//

import assert from "node:assert/strict";
import { nameHour } from "clock-words/plugin/hours";

//
// Gives the greeting for an hour of the day, or a plain one for an hour that is not on the clock.
//
export function greet(hour: number): string {
    assert(typeof hour === "number");
    if (hour >= 0) {
        if (hour < 24) {
            return `Good ${nameHour(hour)}.`;
        }
    }
    return "Hello.";
}
