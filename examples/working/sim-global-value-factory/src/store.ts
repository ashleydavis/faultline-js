//
// A store of values by key, and reading one value out of it.
//

import assert from "node:assert/strict";

//
// Values by key, as a store holds them.
//
export interface IStore {
    //
    // Gives the value held under the key, or undefined when the store holds none.
    //
    read(key: string): string | undefined;

    //
    // Every key the store holds, in the order they were added.
    //
    keys(): string[];
}

//
// Gives the value under the key, or a sentence when the store holds none.
//
export function valueOf(store: IStore, key: string): string {
    assert(typeof key === "string");
    const value = store.read(key);
    if (value === undefined) {
        return "The store holds no such key.";
    }
    return value;
}
