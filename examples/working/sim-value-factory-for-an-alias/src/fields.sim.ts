//
// Records the functions in fields.ts read: one with a name and one without.
//

import type { JsonObject } from "./fields.ts";

//
// A record with a name.
//
export function namedRecord(): JsonObject {
    return {
        name: "shelf",
    };
}

//
// A record with no name.
//
export function emptyRecord(): JsonObject {
    return {};
}
