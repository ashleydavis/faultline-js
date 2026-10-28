//
// An error no code catches, with a message over several lines, as an error carrying a stack trace
// or a list of problems has.
//

import assert from "node:assert/strict";

//
// Starts a check that fails later, listing each problem on a line of its own.
//
export function checkLater(count: number): number {
    assert(typeof count === "number");
    setTimeout(() => {
        throw new Error("The check found two problems:\n  the count is missing\n  the name is missing");
    }, 10);
    return count;
}
