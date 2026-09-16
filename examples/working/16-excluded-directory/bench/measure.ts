// A benchmark, which is a harness rather than code to exercise. The run leaves it out because the
// directory it is in was named in --exclude.

import { highest } from "../sorting.ts";

export function timeIt(rounds: number): number {
    const started = Date.now();
    for (let round = 0; round < rounds; round += 1) {
        highest([1, 2, 3]);
    }
    return Date.now() - started;
}
