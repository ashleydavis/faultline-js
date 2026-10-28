//
// Code that makes code while it runs, the way schema libraries compile their checks.
//

import assert from "node:assert/strict";

//
// Triples a small value with a function made at run time, and gives a large one back unchanged.
//
export function scale(value: number): number {
    assert(typeof value === "number");
    if (value < 10) {
        const triple = new Function("value", "return value * 3;");
        const tripled: number = Reflect.apply(triple, undefined, [value]);
        assert(typeof tripled === "number");
        return tripled;
    }
    return value;
}
