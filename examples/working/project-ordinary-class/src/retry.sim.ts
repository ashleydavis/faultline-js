//
// Ranges for the parser, which no value Faultline builds for a string holds, because the separator
// is not named in a condition.
//

import assert from "node:assert/strict";
import type { ScenarioContext } from "faultline";
import { parseRange } from "./retry.ts";

//
// A range written highest first, and ranges whose first or second number is not a number.
//
export function everyKindOfRange(context: ScenarioContext): void {
    const range = parseRange("9-2");
    assert(range !== undefined);
    context.expect(range.low === 2, "A range written highest first starts at its lowest.");
    context.expect(range.high === 9, "A range written highest first ends at its highest.");
    context.expect(parseRange("x-2") === undefined, "A range whose first part is not a number is refused.");
    context.expect(parseRange("2-x") === undefined, "A range whose second part is not a number is refused.");
}
