//
// A queue filled and then emptied, which no single call does, because each call starts from a new
// copy of the file.
//

import assert from "node:assert/strict";
import type { ScenarioContext } from "faultline";
import { Queue } from "./queue.ts";

//
// Fills a queue of two past its limit and drains it.
//
export function fillAndDrain(context: ScenarioContext): void {
    const queue = new Queue<string>(2);
    context.expect(queue.push("first"), "The first item is taken.");
    context.expect(queue.push("second"), "The second item is taken.");
    context.expect(!queue.push("third"), "A third item is refused by a queue of two.");
    const drained: string[] = [];
    const count = queue.drain((item) => {
        drained.push(item);
    });
    assert(count === drained.length);
    context.expect(drained.join() === "first,second", "The items are drained oldest first.");
    context.expect(queue.size === 0, "A drained queue is empty.");
}
