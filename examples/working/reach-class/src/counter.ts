//
// Every member of a class is exercised: the constructor, the methods, the accessors and a static
// method.
//

import assert from "node:assert/strict";

//
// A running total that refuses amounts below zero.
//
export class Counter {
    //
    // What has been added so far.
    //
    private total: number;

    //
    // Where the count starts.
    //
    constructor(start: number) {
        assert(typeof start === "number");
        this.total = start;
    }

    //
    // Adds an amount, leaving the total as it was for one below zero.
    //
    add(amount: number): number {
        assert(typeof amount === "number");
        if (amount < 0) {
            return this.total;
        }
        this.total += amount;
        return this.total;
    }

    //
    // What has been added so far.
    //
    get value(): number {
        assert(typeof this.total === "number");
        return this.total;
    }

    //
    // Puts the count back to the number given.
    //
    set value(to: number) {
        assert(typeof to === "number");
        this.total = to;
    }

    //
    // Builds a counter starting at zero, which is a method of the class rather than of an instance.
    //
    static empty(): Counter {
        const counter = new Counter(0);
        assert(counter.value === 0);
        return counter;
    }
}
