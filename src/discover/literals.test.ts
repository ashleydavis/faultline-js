// Tests the reading of the values a file's own code tests against and the properties it reads.
// Each test writes a small file into a project in memory and reads it through a real type checker,
// so a name is resolved to the value it stands for. It then checks what was handed over.

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { fixture } from "./fixture.test.ts";
import { literalsIn } from "./literals.ts";
import type { Literals } from "./literals.ts";

// Reads one file written on the spot, the way a run reads a file.
export async function read(text: string): Promise<Literals> {
    const made = await fixture({
        "a.ts": text,
    });
    return literalsIn(made.built.checker, made.source("a.ts"));
}

describe("read", () => {
    test("a file written on the spot is read through the checker", async () => {
        const held = await read('export function f(x: string) { return x === "held"; }');
        assert.deepEqual(held.values, ["held"]);
        assert.deepEqual(held.properties, []);
    });
});

describe("literalsIn", () => {
    test("a string a comparison tests against is read out of the file", async () => {
        assert.ok((await read('export function f(x: string) { return x === "the-one-word"; }')).values.includes("the-one-word"));
    });

    test("a number a comparison tests against is read out of the file", async () => {
        assert.ok((await read("export function f(x: number) { return x > 42; }")).values.includes(42));
    });

    test("a value a case tests against is read out of the file", async () => {
        assert.ok((await read('export function f(x: string) { switch (x) { case "red": return 1; } return 0; }')).values.includes("red"));
    });

    test("what a call asks about a value is read out of the file", async () => {
        assert.ok((await read('export function f(x: string) { return x.startsWith("PNG"); }')).values.includes("PNG"));
    });

    test("a name standing for one value is read as that value", async () => {
        // A file switching on flags names them rather than writing the numbers. The numbers are what
        // the branch turns on.
        const held = await read("const enum Flag { On = 8, Off = 16 }\nexport function f(x: number) { return (x & Flag.On) !== 0; }");
        assert.ok(held.values.includes(8), JSON.stringify(held.values));
    });

    test("a property the file reads is written down, so a stand-in answers it", async () => {
        assert.ok((await read("export interface Held { held: number }\nexport function f(x: Held) { return x.held; }")).properties.includes("held"));
    });

    test("a file testing against no value hands over no value", async () => {
        assert.deepEqual((await read("export function f(x: number) { return x; }")).values, []);
    });

    test("every value a file tests against is handed over, however many there are", async () => {
        // Faultline never cuts a list short to be faster, so a file comparing against more values than
        // any fixed number still has the last of them tried.
        const compared = Array.from({
            length: 100,
        }, (_unused, index) => `x === "word${index}"`).join(" || ");
        const held = await read(`export function f(x: string) { return ${compared}; }`);
        assert.ok(held.values.includes("word99"), JSON.stringify(held.values.length));
        assert.equal(held.values.length, 100);
    });

    test("every property a file reads is written down, however many there are", async () => {
        const reads = Array.from({
            length: 100,
        }, (_unused, index) => `x.p${index}`).join(", ");
        assert.ok((await read(`export function f(x: Record<string, number>) { return [${reads}]; }`)).properties.includes("p99"));
    });

    test("a key the file reads with brackets is read out of the file", async () => {
        assert.ok((await read('export function f(x: Record<string, number>) { return x["the-key"]; }')).values.includes("the-key"));
    });

    test("a boolean a comparison tests against is read out of the file", async () => {
        const held = await read("export function f(x: boolean, y: boolean) { return x === true || y === false; }");
        assert.ok(held.values.includes(true), JSON.stringify(held.values));
        assert.ok(held.values.includes(false), JSON.stringify(held.values));
    });

    test("a new written with no brackets hands over no value", async () => {
        assert.deepEqual((await read("class Thing {}\nexport function f() { return new Thing; }")).values, []);
    });
});
