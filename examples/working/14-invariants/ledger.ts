// A ledger whose two sides have to stay equal, whatever is done to it.

// What has been put in and what has been taken out, which have to add up.
export class Ledger {
    // Everything put in.
    private credits = 0;

    // Everything taken out.
    private debits = 0;

    // Puts an amount in, refusing one below zero.
    put(amount: number): boolean {
        if (amount < 0) {
            return false;
        }
        this.credits += amount;
        return true;
    }

    // Takes an amount out, refusing more than is there.
    take(amount: number): boolean {
        if (amount < 0 || amount > this.credits - this.debits) {
            return false;
        }
        this.debits += amount;
        return true;
    }

    // What is left.
    get balance(): number {
        return this.credits - this.debits;
    }
}

// The one ledger every call works on, so an invariant has something to hold over.
export const theLedger = new Ledger();
