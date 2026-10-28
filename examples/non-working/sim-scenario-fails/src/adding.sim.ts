//
// A scenario that expects the wrong answer, so the run reports it.
//

import assert from "node:assert/strict";
import type { ScenarioContext } from "faultline";
import { addOne } from "./adding.ts";

//
// Expects one plus one to be three.
//
export function addsWrong(context: ScenarioContext): void {
    const sum = addOne(1);
    assert(typeof sum === "number");
    context.expect(sum === 3, "One plus one is three.");
}
