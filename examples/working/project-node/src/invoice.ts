//
// The total of an invoice, importing the money file the way Node's own resolution wants: by the
// `.js` name the file has once it is built.
//

import assert from "node:assert/strict";
import { add, format, type IMoney } from "./money.js";

//
// Writes out the total of two amounts, or says they cannot be added.
//
export function totalOf(first: IMoney, second: IMoney): string {
    assert(typeof first.currency === "string");
    const total = add(first, second);
    if (!total) {
        return "The amounts are in different currencies.";
    }
    return format(total);
}
