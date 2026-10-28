//
// A branch that needs two parameters changed from their baseline at once, which a call changing
// one parameter at a time never reaches.
//

import assert from "node:assert/strict";

//
// Says which colours are mixed in.
//
export function mixedColour(red: boolean, green: boolean, blue: boolean): string {
    assert(typeof red === "boolean");
    assert(typeof blue === "boolean");
    if (red) {
        if (green) {
            return "yellow";
        }
    }
    if (blue) {
        return "blue";
    }
    return "none";
}
