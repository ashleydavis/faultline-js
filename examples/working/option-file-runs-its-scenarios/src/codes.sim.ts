//
// The scenario that types a valid code, which no value Faultline picks itself is.
//

import type { ScenarioContext } from "faultline";
import { isCodeValid } from "./codes.ts";

//
// A code whose last digit is the sum of the others.
//
export function typeValidCode(context: ScenarioContext): void {
    const valid = isCodeValid("1236");
    context.expect(valid, "1236 to be a valid code");
}
