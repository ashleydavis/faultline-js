// The invariant over the ledger, which takes nothing and gives nothing back.

import { theLedger } from "./ledger.ts";

// A ledger that has been taken from more than it was put into is broken, whatever was called.
export function theBalanceIsNeverNegative(): void {
    if (theLedger.balance < 0) {
        throw new Error("TheBalanceWentNegative");
    }
}
