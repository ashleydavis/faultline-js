//
// Counting what is on a shelf.
//

import assert from "node:assert/strict";

//
// A shelf and what is on it.
//
export interface IShelf {
    //
    // How many things are on it.
    //
    count: number;
}

//
// Says whether the shelf is empty.
//
export function isEmpty(shelf: IShelf): boolean {
    assert(typeof shelf.count === "number");
    return shelf.count === 0;
}
