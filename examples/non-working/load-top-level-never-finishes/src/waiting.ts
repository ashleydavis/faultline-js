//
// A file whose top level never finishes, as one waiting on a flag no code sets does.
//

import assert from "node:assert/strict";

//
// Whether the file may finish loading, which no code ever sets. It sits at module level because
// the loop that reads it is the file's top level, which has no caller to pass it down.
//
export const state = {
    ready: false,
};

assert(typeof state.ready === "boolean");
while (!state.ready) {
    assert(typeof state.ready === "boolean");
}
