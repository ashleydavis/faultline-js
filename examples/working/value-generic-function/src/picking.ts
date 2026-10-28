//
// Two generic functions, one with a constraint and one without.
//

import assert from "node:assert/strict";

//
// Something that has a length, as a string and a list do.
//
export interface ILengthy {
    //
    // How long it is.
    //
    length: number;
}

//
// Gives the first item, or the fallback when the list is empty or starts with undefined.
//
export function firstOf<T>(items: T[], fallback: T): T {
    assert(Array.isArray(items));
    const [first] = items;
    if (first === undefined) {
        return fallback;
    }
    return first;
}

//
// Counts the items at least as long as the shortest allowed.
//
export function longEnough<T extends ILengthy>(items: T[], shortest: number): number {
    assert(Array.isArray(items));
    let found = 0;
    for (const item of items) {
        if (item.length >= shortest) {
            found += 1;
        }
    }
    assert(found <= items.length);
    return found;
}
