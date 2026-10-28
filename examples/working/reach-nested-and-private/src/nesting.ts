//
// A private function, and a callback that belongs to the function that wrote it.
//

import assert from "node:assert/strict";

//
// Takes the full stop off the end of a name. The file does not export it, and Faultline calls it
// anyway.
//
function trimmed(text: string): string {
    assert(typeof text === "string");
    if (text.endsWith(".")) {
        return text.slice(0, -1);
    }
    return text;
}

//
// Takes the full stop off every name, writing a placeholder for an empty one.
//
export function shortNames(names: string[]): string[] {
    assert(Array.isArray(names));
    return names.map((name) => {
        if (name === "") {
            return "(none)";
        }
        return trimmed(name);
    });
}
