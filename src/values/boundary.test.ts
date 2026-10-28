// Checks the boundary value lists, the seed mixing and the seeded value generators.
//
// The lists are compared with what the user guide promises, the mixing is checked to give the same
// seed for the same inputs and different seeds for different ones, and each generator is drawn from
// a fixed seed and checked for staying inside its range and for repeating under the same seed.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { clockStartMs } from "../world/clock.ts";
import { SeededRng } from "../world/random.ts";
import {
    boundaryBigints,
    boundaryBooleans,
    boundaryByteLengths,
    boundaryDateMs,
    boundaryNumbers,
    boundaryStrings,
    boundaryUrls,
    bytesOf,
    errorOf,
    finalised,
    longestSeededLength,
    mixSeed,
    seededBigint,
    seededBoolean,
    seededDateMs,
    seededNumber,
    seededRngFor,
    seededString,
} from "./boundary.ts";

test("the boundary numbers are the ones the user guide lists, minus zero kept apart from zero", () => {
    assert.deepEqual(boundaryNumbers, [0, 1, -1, 0.5, -0, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.NaN, Infinity, -Infinity]);
    assert.ok(Object.is(boundaryNumbers[4], -0));
    assert.ok(Object.is(boundaryNumbers[0], 0));
});

test("the boundary strings, bigints and booleans are the empty and shortest ones, and both flags", () => {
    assert.deepEqual(boundaryStrings, ["", "a"]);
    assert.deepEqual(boundaryBigints, [0n, 1n, -1n]);
    assert.deepEqual(boundaryBooleans, [false, true]);
});

test("the boundary dates, addresses and byte lengths are fixed", () => {
    assert.deepEqual(boundaryDateMs, [0, clockStartMs, Number.NaN]);
    assert.equal(boundaryUrls.length, 2);
    for (const url of boundaryUrls) {
        assert.equal(new URL(url).href, url);
    }
    assert.deepEqual(boundaryByteLengths, [0, 1]);
});

test("the same seed, position and index always mix to the same seed", () => {
    assert.equal(mixSeed(7, 0, 0), mixSeed(7, 0, 0));
    assert.equal(mixSeed(7, 2, 3), mixSeed(7, 2, 3));
});

test("a different seed, position or index mixes to a different seed", () => {
    const mixed = mixSeed(7, 0, 0);
    assert.notEqual(mixSeed(8, 0, 0), mixed);
    assert.notEqual(mixSeed(7, 1, 0), mixed);
    assert.notEqual(mixSeed(7, 0, 1), mixed);
    assert.notEqual(mixSeed(7, 1, 0), mixSeed(7, 0, 1));
});

test("the mixed seed is a 32-bit unsigned number", () => {
    for (const seed of [0, 1, -1, 2 ** 40, 123456789]) {
        const mixed = mixSeed(seed, 3, 2);
        assert.ok(Number.isInteger(mixed));
        assert.ok(mixed >= 0 && mixed < 2 ** 32);
    }
});

test("a position or index that is not a whole number at or above zero is refused", () => {
    assert.throws(() => mixSeed(1, -1, 0));
    assert.throws(() => mixSeed(1, 0, 0.5));
});

test("the finaliser maps zero to zero and spreads one bit of input over many of output", () => {
    assert.equal(finalised(0), 0);
    const changed = (finalised(1) ^ finalised(0)).toString(2).replace(/0/g, "").length;
    assert.ok(changed > 8, `One input bit changed only ${changed} output bits.`);
});

test("seeded numbers are small whole numbers or fractions within a thousand of zero", () => {
    const rng = new SeededRng(1);
    let wholes = 0;
    let fractions = 0;
    for (let draw = 0; draw < 200; draw += 1) {
        const value = seededNumber(rng);
        if (Number.isInteger(value) && Math.abs(value) <= 256) {
            wholes += 1;
            continue;
        }
        assert.ok(Math.abs(value) <= 1000, `${value} is out of range.`);
        fractions += 1;
    }
    assert.ok(wholes > 0);
    assert.ok(fractions > 0);
});

test("seeded strings are lower case letters no longer than the longest seeded length", () => {
    const rng = new SeededRng(2);
    const lengths = new Set<number>();
    for (let draw = 0; draw < 200; draw += 1) {
        const text = seededString(rng);
        assert.match(text, /^[a-z]*$/);
        assert.ok(text.length <= longestSeededLength);
        lengths.add(text.length);
    }
    assert.ok(lengths.has(0));
    assert.ok(lengths.has(longestSeededLength));
});

test("seeded bigints, booleans and dates stay in their ranges", () => {
    const rng = new SeededRng(3);
    const flags = new Set<boolean>();
    for (let draw = 0; draw < 100; draw += 1) {
        const big = seededBigint(rng);
        assert.ok(big >= -256n && big <= 256n);
        flags.add(seededBoolean(rng));
        const ms = seededDateMs(rng);
        assert.ok(Math.abs(ms - clockStartMs) <= 86400000);
    }
    assert.deepEqual([...flags].sort(), [false, true]);
});

test("the same seed draws the same seeded values", () => {
    const first = seededRngFor(11, 1, 2);
    const second = seededRngFor(11, 1, 2);
    assert.equal(seededString(first), seededString(second));
    assert.equal(seededNumber(first), seededNumber(second));
    assert.equal(first.position, second.position);
});

test("bytes are built as the runtime type named, holding the bytes given", () => {
    const bytes = Uint8Array.from([1, 2]);
    const plain = bytesOf("Uint8Array", bytes);
    assert.equal(Object.getPrototypeOf(plain), Uint8Array.prototype);
    assert.deepEqual([...new Uint8Array(plain)], [1, 2]);
    const buffer = bytesOf("Buffer", bytes);
    assert.ok(Buffer.isBuffer(buffer));
    assert.deepEqual([...new Uint8Array(buffer)], [1, 2]);
    const arrayBuffer = bytesOf("ArrayBuffer", bytes);
    assert.ok(arrayBuffer instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(arrayBuffer)], [1, 2]);
});

test("errors are built as the runtime type named, with the message given", () => {
    const plain = errorOf("Error", "a");
    assert.equal(plain.name, "Error");
    assert.equal(plain.message, "a");
    assert.ok(errorOf("TypeError", "") instanceof TypeError);
    assert.ok(errorOf("RangeError", "") instanceof RangeError);
});
