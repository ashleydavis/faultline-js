//
// A file that imports something that is not code, and a branch per state of a book.
//

import assert from "node:assert/strict";
import "./styles.css";

//
// Gives the stylesheet classes a book is drawn with in each state.
//
export function classFor(state: string): string {
    assert(typeof state === "string");
    if (state === "settled") {
        return "book book-settled";
    }
    if (state === "waiting") {
        return "book book-waiting";
    }
    return "book";
}
