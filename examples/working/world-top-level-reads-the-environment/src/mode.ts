//
// A file whose top level reads the environment when it is imported.
//

import assert from "node:assert/strict";

//
// The mode the program runs in, read once when the file is imported: the `MODE` environment
// variable, or "production" when it is not set.
//
const MODE_SET = process.env.MODE;
export const MODE = MODE_SET === undefined ? "production" : MODE_SET;

//
// Says whether the program runs in the mode for working on it.
//
export function isDevelopment(): boolean {
    assert(typeof MODE === "string");
    return MODE === "development";
}
