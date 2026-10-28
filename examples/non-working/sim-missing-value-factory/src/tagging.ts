//
// A parameter whose type Faultline cannot build, so the function is not called until a value
// factory says what one is.
//

import assert from "node:assert/strict";

//
// A name only this module can make.
//
export type Tag = symbol;

//
// Says whether a tag's description is long.
//
export function nameOf(tag: Tag): string {
    const text = String(tag);
    assert(typeof text === "string");
    if (text.length > 10) {
        return "long";
    }
    return "short";
}
