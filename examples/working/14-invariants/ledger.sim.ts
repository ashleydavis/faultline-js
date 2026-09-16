// The invariant over the ledger, which takes the subject and nothing else.

import type { Subject } from "faultline";
import { theLedger } from "./ledger.ts";

// A ledger that has been taken from more than it was put into is broken, whatever was called.
export function theBalanceIsNeverNegative(self: Subject): void {
    void self;

    if (theLedger.balance < 0) {
        throw new Error("TheBalanceWentNegative");
    }
}
