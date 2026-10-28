// Where in one call a simulated effect can fail.
//
// A place is named by the effect and by how many calls of that effect came before it in the same
// call of the function under test. Two runs that make the same calls in the same order agree on
// every place, on any machine, so a replay token that names a place names the same one on every
// run. A place is never a source line: the same line read in a loop is a different place on each
// turn, and a line moved by an edit is still the same place.

import type { Effect } from "./failures.ts";

// One place a simulated effect can fail: the occurrence-th call of that effect in this call,
// counting from zero.
export interface Place {
    // What the call was.
    effect: Effect;

    // How many calls of the same effect came before this one in the same call.
    occurrence: number;
}

// A place written the one way a replay token and a report both read it: `effect#occurrence`.
export function placeName(place: Place): string {
    return `${place.effect}#${place.occurrence}`;
}

// Whether two places are the same one.
export function isSamePlace(first: Place, second: Place): boolean {
    return first.effect === second.effect && first.occurrence === second.occurrence;
}

// Numbers the calls of each effect in one call, so every call of an effect is given its place.
export class PlaceCounter {
    // How many calls of each effect have been numbered so far.
    private readonly counts = new Map<Effect, number>();

    // The place of the next call of `effect`, which moves that effect's count on by one.
    next(effect: Effect): Place {
        const occurrence = this.counts.get(effect) ?? 0;
        this.counts.set(effect, occurrence + 1);
        return { effect, occurrence };
    }
}
