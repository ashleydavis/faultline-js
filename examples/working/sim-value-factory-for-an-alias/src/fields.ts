//
// Reading fields out of a record parsed from JSON.
//

import assert from "node:assert/strict";

//
// A record parsed from JSON, which nothing here changes.
//
export type JsonObject = Readonly<Record<string, unknown>>;

//
// The record's name, or "unnamed" when it has none or it is not text.
//
export function readName(record: JsonObject): string {
    assert(typeof record === "object");
    const name = record["name"];
    if (typeof name === "string") {
        return name;
    }
    return "unnamed";
}
