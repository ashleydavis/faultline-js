//
// The two code paths every short circuiting operator has.
//

import assert from "node:assert/strict";

//
// Says whether both are set. The right side runs only when the left is true.
//
export function bothSet(left: string, right: string): boolean {
    assert(typeof left === "string");
    assert(typeof right === "string");
    return left.length > 0 && right.length > 0;
}

//
// Says whether either is set. The right side runs only when the left is false.
//
export function eitherSet(left: string, right: string): boolean {
    assert(typeof left === "string");
    assert(typeof right === "string");
    return left.length > 0 || right.length > 0;
}

//
// Gives the value or a default. The right side runs only when the left is undefined.
//
export function orElse(given: string | undefined): string {
    const chosen = given ?? "the default";
    assert(typeof chosen === "string");
    return chosen;
}
