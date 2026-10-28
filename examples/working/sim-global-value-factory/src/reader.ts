//
// Reading the first value a store holds.
//

import assert from "node:assert/strict";
import type { IStore } from "./store.ts";

//
// Gives the value under the first key, or a sentence for an empty store.
//
export function firstOf(store: IStore): string {
    const keys = store.keys();
    assert(Array.isArray(keys));
    const [first] = keys;
    if (first === undefined) {
        return "The store is empty.";
    }
    return store.read(first) ?? "The store lost its first value.";
}
