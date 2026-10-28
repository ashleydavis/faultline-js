//
// Every arm of a switch is a code path, and an arm that falls through is counted by the arm it
// falls to.
//

import assert from "node:assert/strict";

//
// Names how many there are, one arm per answer.
//
export function nameOf(kind: 0 | 1 | 2 | 3): string {
    assert(Number.isInteger(kind));
    switch (kind) {
        case 0:
            return "none";
        case 1:
        case 2:
            return "some";
        default:
            return "many";
    }
}
