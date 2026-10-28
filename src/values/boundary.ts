// The fixed lists of boundary values for each built-in type and the values drawn from a seeded
// generator for each.
//
// Boundary values are the ones that make a branch go one way rather than the other: zero, one and
// minus one because a loop or a sign check splits on them, the largest and smallest safe integers
// because a range check has a side each, the empty and the shortest string because a parser decides
// its empty and shortest cases on them. A seeded value comes from a generator whose seed is the
// run's seed mixed with the parameter's position and the choice's index, so the same seed always
// gives the same values.

import assert from "node:assert/strict";
import { clockStartMs } from "../world/clock.ts";
import { SeededRng } from "../world/random.ts";
import type { BytesName, ErrorName } from "../discover/recipes.ts";

// How many values the seeded generator supplies for each parameter, besides the boundary values. A
// few, because the boundary values and the values read from the conditions do the targeted work and
// these only add variety. Each one is another call per failure place, so more would cost more than
// they find.
export const seededCount = 4;

// The longest string, list, set, map or byte array the generator builds. Short, because what
// matters is that the length differs between draws, not that the value is big.
export const longestSeededLength = 8;

// The numbers a `number` parameter is tried with, in the order the user guide lists them: zero, one
// and minus one for a loop or a sign check, a half for code that rounds, minus zero for code that
// divides by it, the safe integer limits for a range check, and the three values arithmetic gives
// back from a bug.
export const boundaryNumbers: readonly number[] = [
    0,
    1,
    -1,
    0.5,
    -0,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
];

// The strings a `string` parameter is tried with: the empty string and a one character string,
// which is where a parser's empty and shortest cases are decided.
export const boundaryStrings: readonly string[] = [
    "",
    "a",
];

// The bigints a `bigint` parameter is tried with: zero, one and minus one, for the same reason as
// the numbers.
export const boundaryBigints: readonly bigint[] = [
    0n,
    1n,
    -1n,
];

// The booleans, false first because the code that runs when a flag is off is the baseline.
export const boundaryBooleans: readonly boolean[] = [
    false,
    true,
];

// The times a `Date` parameter is tried with, in milliseconds since the epoch: the epoch itself,
// the time the simulated clock starts at, and not a number, which is what `new Date("junk")` holds
// and what code checking `isNaN(date.getTime())` is written for.
export const boundaryDateMs: readonly number[] = [
    0,
    clockStartMs,
    Number.NaN,
];

// The addresses a `URL` parameter is tried with: one with no path and one with a path, a query and
// a fragment, so code reading each part has one value with it and one without.
export const boundaryUrls: readonly string[] = [
    "https://example.com/",
    "https://example.com/a?b=c#d",
];

// The lengths of a byte array: empty and one byte, as for a string.
export const boundaryByteLengths: readonly number[] = [
    0,
    1,
];

// Mixes the run's seed with a parameter's position and a choice's index into the seed of the
// generator that one value is drawn from. The position is in it so two parameters of the same type
// are not given the same value, which would hide every branch that needs them to differ. The mixing
// is MurmurHash3's finaliser, which spreads every input bit over the whole result.
export function mixSeed(seed: number, position: number, index: number): number {
    assert.ok(Number.isInteger(position) && position >= 0);
    assert.ok(Number.isInteger(index) && index >= 0);
    let mixed = seed >>> 0;
    // 0x9e3779b1 and 0x85ebca77 are the golden ratio and a MurmurHash3 prime, odd multipliers that
    // keep every bit of the position and the index.
    mixed = finalised(mixed ^ Math.imul(position + 1, 0x9e3779b1));
    mixed = finalised(mixed ^ Math.imul(index + 1, 0x85ebca77));
    return mixed;
}

// MurmurHash3's 32-bit finaliser. Its constants are the published ones; changing them changes every
// seeded value of every run.
export function finalised(value: number): number {
    let mixed = value >>> 0;
    mixed ^= mixed >>> 16;
    mixed = Math.imul(mixed, 0x85ebca6b);
    mixed ^= mixed >>> 13;
    mixed = Math.imul(mixed, 0xc2b2ae35);
    mixed ^= mixed >>> 16;
    return mixed >>> 0;
}

// A seeded number. Half the draws are small integers and half are fractions, because the branches
// in real code compare against small whole constants far more often than against anything else,
// and the extremes are already boundary values.
export function seededNumber(rng: SeededRng): number {
    if (rng.int(0, 1) === 0) {
        return rng.int(-256, 256);
    }
    // Between minus one thousand and one thousand: wide enough to cross the thresholds code
    // compares against, small enough to stay finite in any arithmetic.
    return (rng.next() - 0.5) * 2000;
}

// A seeded string of lower case letters, of a seeded length.
export function seededString(rng: SeededRng): string {
    const length = rng.int(0, longestSeededLength);
    let text = "";
    for (let index = 0; index < length; index += 1) {
        // 97 is the character code of "a" and the letters run on from it to "z".
        text += String.fromCharCode(rng.int(97, 122));
    }
    assert.equal(text.length, length);
    return text;
}

// A seeded bigint, small for the same reason as a seeded number.
export function seededBigint(rng: SeededRng): bigint {
    return BigInt(rng.int(-256, 256));
}

// A seeded boolean.
export function seededBoolean(rng: SeededRng): boolean {
    return rng.int(0, 1) === 1;
}

// A seeded time, within a day either side of the time the simulated clock starts at, so it falls
// on each side of "now" as code under test reads it.
export function seededDateMs(rng: SeededRng): number {
    // 86400000 is the milliseconds in a day.
    return clockStartMs + rng.int(-86400000, 86400000);
}

// A byte array of the runtime type named, holding the bytes given.
export function bytesOf(name: BytesName, bytes: Uint8Array): Uint8Array | ArrayBuffer {
    if (name === "Buffer") {
        return Buffer.from(bytes);
    }
    if (name === "ArrayBuffer") {
        const buffer = new ArrayBuffer(bytes.length);
        new Uint8Array(buffer).set(bytes);
        return buffer;
    }
    return Uint8Array.from(bytes);
}

// An error of the runtime type named, with the message given.
export function errorOf(name: ErrorName, message: string): Error {
    if (name === "TypeError") {
        return new TypeError(message);
    }
    if (name === "RangeError") {
        return new RangeError(message);
    }
    return new Error(message);
}

// A seeded generator for one value: the run's seed mixed with the parameter's position and the
// choice's index.
export function seededRngFor(seed: number, position: number, index: number): SeededRng {
    return new SeededRng(mixSeed(seed, position, index));
}
