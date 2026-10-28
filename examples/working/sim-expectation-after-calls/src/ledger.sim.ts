//
// What has to hold after every call of a function in the ledger file.
//

import assert from "node:assert/strict";
import type { ExpectationContext } from "faultline";
import { theLedger } from "./ledger.ts";

//
// A ledger is broken when more was taken out than was put in, whatever was called.
//
export function balanceIsNeverNegative(context: ExpectationContext): void {
    const balance = theLedger.balance;
    assert(typeof balance === "number");
    context.expect(!(balance < 0), "The balance is never below zero.");
}
