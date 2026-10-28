//
// A ledger whose balance has to stay at zero or above, whatever is done to it.
//

import assert from "node:assert/strict";

//
// What has been put in and what has been taken out.
//
export class Ledger {
    //
    // Everything put in.
    //
    private credits = 0;

    //
    // Everything taken out.
    //
    private debits = 0;

    //
    // Puts an amount in, refusing one below zero.
    //
    put(amount: number): boolean {
        assert(typeof amount === "number");
        if (amount < 0) {
            return false;
        }
        this.credits += amount;
        return true;
    }

    //
    // Takes an amount out, refusing more than is there.
    //
    take(amount: number): boolean {
        assert(typeof amount === "number");
        if (amount > this.balance) {
            return false;
        }
        if (amount < 0) {
            return false;
        }
        this.debits += amount;
        return true;
    }

    //
    // What is left.
    //
    get balance(): number {
        assert(typeof this.credits === "number");
        return this.credits - this.debits;
    }
}

//
// The ledger the functions below work on, so the expectation function has one ledger to check.
//
export const theLedger = new Ledger();

//
// Puts an amount into the ledger.
//
export function deposit(amount: number): boolean {
    assert(typeof amount === "number");
    return theLedger.put(amount);
}

//
// Takes an amount out of the ledger.
//
export function withdraw(amount: number): boolean {
    assert(typeof amount === "number");
    return theLedger.take(amount);
}
