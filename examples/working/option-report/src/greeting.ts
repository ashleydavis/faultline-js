//
// A function to fault test, so the report file has a code path to list.
//

import assert from "node:assert/strict";

//
// Gives a greeting for a name.
//
export function greet(name: string): string {
    assert(typeof name === "string");
    const greeting = `Hello, ${name}.`;
    assert(greeting.length > name.length);
    return greeting;
}
