//
// One code path per loop body, whichever way the loop is written.
//

import assert from "node:assert/strict";

//
// Adds up a list, which is the ordinary loop.
//
export function total(items: number[]): number {
    assert(Array.isArray(items));
    let sum = 0;
    for (const item of items) {
        sum += item;
    }
    return sum;
}

//
// Counts up to a number, stopping at ten so the loop has a bound whatever it is given.
//
export function countdown(from: number): number {
    assert(typeof from === "number");
    let steps = 0;
    while (steps < Math.min(from, 10)) {
        steps += 1;
    }
    assert(steps <= 10);
    return steps;
}

//
// Adds up the lengths of the keys of an object.
//
export function keyCount(held: Record<string, number>): number {
    assert(typeof held === "object");
    let seen = 0;
    for (const key in held) {
        seen += key.length;
    }
    assert(seen >= 0);
    return seen;
}
