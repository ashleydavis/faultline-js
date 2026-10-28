//
// The value factories for a store, which every file that takes one uses.
//

import assert from "node:assert/strict";
import type { IStore } from "./store.ts";

//
// A store over a map of values.
//
export class MapStore implements IStore {
    //
    // The values the store holds, by key.
    //
    private values: Map<string, string>;

    //
    // Builds a store holding the values given.
    //
    constructor(values: Map<string, string>) {
        assert(values instanceof Map);
        this.values = values;
    }

    //
    // Gives the value under the key.
    //
    read(key: string): string | undefined {
        assert(typeof key === "string");
        return this.values.get(key);
    }

    //
    // Every key, in the order the values were added.
    //
    keys(): string[] {
        assert(this.values instanceof Map);
        return [...this.values.keys()];
    }
}

//
// A store holding no value.
//
export function emptyStore(): IStore {
    const store = new MapStore(new Map());
    assert(store.keys().length === 0);
    return store;
}

//
// A store holding one value under the empty string, the first value Faultline gives a string, so
// a read of it finds one.
//
export function storeOfOne(): IStore {
    const store = new MapStore(new Map([["", "the value of the empty key"]]));
    assert(store.keys().length === 1);
    return store;
}

//
// A store whose first key reads as undefined, as a store that lost a value does.
//
export function storeThatLostItsValue(): IStore {
    const store: IStore = {
        read(key: string): string | undefined {
            assert(typeof key === "string");
            return undefined;
        },
        keys(): string[] {
            return ["lost"];
        },
    };
    assert(store.keys().length === 1);
    return store;
}
