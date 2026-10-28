//
// Greeting the person a call is made for.
//

import assert from "node:assert/strict";

//
// Greets the caller by name, or as a guest when they gave none.
//
export function greet(caller: ICaller): string {
    assert(typeof caller.name === "string");
    if (caller.name === "") {
        return "Hello, guest.";
    }
    return `Hello, ${caller.name}.`;
}
