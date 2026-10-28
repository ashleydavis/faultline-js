//
// A benchmark, which measures the code rather than being code to test. The run leaves it out
// because its directory is named in `exclude`.
//

import assert from "node:assert/strict";
import { highest } from "../sorting.ts";

//
// Gives how long a number of rounds of `highest` took, in milliseconds.
//
export function timeIt(rounds: number): number {
    assert(Number.isInteger(rounds));
    const started = Date.now();
    for (let round = 0; round < rounds; round += 1) {
        highest([1, 2, 3]);
    }
    return Date.now() - started;
}
