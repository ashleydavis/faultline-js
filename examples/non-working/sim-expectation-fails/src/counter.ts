//
// A counter that lets itself go below zero, which the expectation function beside it says it may
// not.
//

import assert from "node:assert/strict";

//
// A count that is taken down one at a time.
//
export class Counter {
    //
    // What is left.
    //
    private held = 0;

    //
    // Takes one off without checking what is left.
    //
    takeOne(): number {
        this.held -= 1;
        assert(Number.isInteger(this.held));
        return this.held;
    }

    //
    // What is left.
    //
    get left(): number {
        assert(typeof this.held === "number");
        return this.held;
    }
}

//
// The counter the function below works on, so the expectation function has one counter to check.
//
export const theCounter = new Counter();

//
// Takes one off the counter.
//
export function spendOne(): number {
    const left = theCounter.takeOne();
    assert(typeof left === "number");
    return left;
}
