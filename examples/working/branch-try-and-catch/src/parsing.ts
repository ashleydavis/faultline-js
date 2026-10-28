//
// A `try` is two code paths: the body running and the `catch`.
//

import assert from "node:assert/strict";

//
// Gives how long the value written as JSON is once written back as text, or -1 when the text is
// not JSON.
//
export function lengthOfJson(text: string): number {
    assert(typeof text === "string");
    try {
        const parsed: unknown = JSON.parse(text);
        return String(parsed).length;
    }
    catch {
        return -1;
    }
}
