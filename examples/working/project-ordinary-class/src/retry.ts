//
// Trying work again after it fails, and reading a range of numbers out of text.
//

import assert from "node:assert/strict";

//
// Runs the work up to `times` times, waiting longer after each failure, and gives the first answer
// or undefined when every attempt failed.
//
export async function withRetries<T>(work: () => Promise<T>, times: number): Promise<T | undefined> {
    assert(typeof work === "function");
    assert(typeof times === "number");
    for (let attempt = 0; attempt < times; attempt += 1) {
        try {
            return await work();
        }
        catch {
            await new Promise<void>((settle) => {
                setTimeout(settle, 100 * (attempt + 1));
            });
        }
    }
    return undefined;
}

//
// A range of numbers, lowest first.
//
export interface IRange {
    //
    // The lowest number in the range.
    //
    low: number;

    //
    // The highest number in the range.
    //
    high: number;
}

//
// Reads a range written as two numbers with `-` between them, in either order, or gives undefined
// for text that is not one.
//
export function parseRange(text: string): IRange | undefined {
    assert(typeof text === "string");
    const parts = text.split("-");
    if (parts.length !== 2) {
        return undefined;
    }
    const first = Number(parts[0]);
    const second = Number(parts[1]);
    if (Number.isNaN(first)) {
        return undefined;
    }
    if (Number.isNaN(second)) {
        return undefined;
    }
    return {
        low: Math.min(first, second),
        high: Math.max(first, second),
    };
}
