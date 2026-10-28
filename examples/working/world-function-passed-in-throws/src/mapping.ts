//
// Code that calls a function it was given and handles it failing.
//

import assert from "node:assert/strict";

//
// Applies a function to each item and counts the items it threw on.
//
export function countFailures(items: number[], convert: (value: number) => string): number {
    assert(Array.isArray(items));
    let failed = 0;
    for (const item of items) {
        try {
            convert(item);
        }
        catch {
            failed += 1;
        }
    }
    assert(failed <= items.length);
    return failed;
}

//
// Waits for a function that gives a promise, and gives a sentence instead when the promise rejects.
//
export async function answerOf(ask: () => Promise<string>): Promise<string> {
    assert(typeof ask === "function");
    try {
        return await ask();
    }
    catch {
        return "The question could not be answered.";
    }
}
