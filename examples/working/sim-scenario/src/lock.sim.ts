//
// The scenario that takes the lock twice, which no single call does.
//

import assert from "node:assert/strict";
import type { ScenarioContext } from "faultline";
import { Lock } from "./lock.ts";

//
// Takes the lock, asks for it again while it is held and gives it back.
//
export function takeItTwice(context: ScenarioContext): void {
    const lock = new Lock();
    assert(lock instanceof Lock);
    context.expect(lock.take(), "The first take is allowed.");
    context.expect(!lock.take(), "A second take while the lock is held is refused.");
    lock.release();
}
