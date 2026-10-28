// The values read from the conditions in one function's source.
//
// A condition such as `count > 100` or `name.startsWith("v")` says which constant decides a branch,
// so the values worth trying are the constant and the values on each side of it. Each list follows
// the order of the conditions and holds no value twice, so the same conditions always give the same
// calls. A condition does not say which parameter it tests, so every parameter of a type is offered
// every value of that type.

import assert from "node:assert/strict";
import type { Condition } from "../discover/conditions.ts";

// The values read from a function's conditions, by the type they can be given to.
export interface ICandidates {
    // The numbers: each number tested against and its neighbour on each side.
    numbers: number[];

    // The strings: each string tested against and a near miss of it, and for a prefix or a suffix
    // test the string with something added at the other end.
    strings: string[];

    // The bigints: each bigint tested against and one either side.
    bigints: bigint[];

    // The booleans tested against.
    booleans: boolean[];
}

// What is added to a string to make one that starts or ends with a literal and is longer than it.
// One character, because the point is only that the string matches at one end and not the other.
const extraText = "a";

// Reads the candidates out of a function's conditions. A `typeof` check names a type, not a value,
// and an `in` check names a key of the object it looks in, so neither gives a value to pass.
export function candidatesOf(conditions: readonly Condition[]): ICandidates {
    const candidates: ICandidates = {
        numbers: [],
        strings: [],
        bigints: [],
        booleans: [],
    };
    for (const condition of conditions) {
        const literal = condition.literal;
        if (literal === undefined) {
            continue;
        }
        if (condition.kind === "typeof" || condition.kind === "in") {
            continue;
        }
        if (literal.kind === "number") {
            assert.equal(typeof literal.value, "number");
            addNumberSides(candidates.numbers, Number(literal.value));
            continue;
        }
        if (literal.kind === "string") {
            assert.equal(typeof literal.value, "string");
            addStringSides(candidates.strings, String(literal.value), condition.kind);
            continue;
        }
        if (literal.kind === "bigint") {
            const middle = BigInt(String(literal.value));
            addDistinct(candidates.bigints, middle);
            addDistinct(candidates.bigints, middle - 1n);
            addDistinct(candidates.bigints, middle + 1n);
            continue;
        }
        if (literal.kind === "boolean") {
            addDistinct(candidates.booleans, literal.value === true);
        }
    }
    return candidates;
}

// Adds a number and its neighbour on each side: one below and one above for a whole number, the
// next number a double can hold for a fraction. A number that is not finite has no sides.
export function addNumberSides(numbers: number[], middle: number): void {
    if (!Number.isFinite(middle)) {
        return;
    }
    addDistinct(numbers, middle);
    if (Number.isInteger(middle)) {
        addDistinct(numbers, middle - 1);
        addDistinct(numbers, middle + 1);
        return;
    }
    addDistinct(numbers, adjacentNumber(middle, -1));
    addDistinct(numbers, adjacentNumber(middle, 1));
}

// Adds a string, a near miss of it and, for a prefix or suffix test, the two strings that carry it
// and its near miss at that end with something at the other.
export function addStringSides(strings: string[], text: string, kind: Condition["kind"]): void {
    const near = nearMiss(text);
    addDistinct(strings, text);
    addDistinct(strings, near);
    if (kind === "starts-with") {
        addDistinct(strings, `${text}${extraText}`);
        addDistinct(strings, `${near}${extraText}`);
        return;
    }
    if (kind === "ends-with") {
        addDistinct(strings, `${extraText}${text}`);
        addDistinct(strings, `${extraText}${near}`);
    }
}

// A string as long as `text` that differs from it in the lowest bit of its last character, so it is
// almost the same and never equal. The empty string has no last character, so its near miss is one
// character long.
export function nearMiss(text: string): string {
    if (text.length === 0) {
        return extraText;
    }
    const last = text.charCodeAt(text.length - 1);
    const near = `${text.slice(0, -1)}${String.fromCharCode(last ^ 1)}`;
    assert.notEqual(near, text);
    assert.equal(near.length, text.length);
    return near;
}

// The next double after `value` towards minus infinity (`direction` -1) or plus infinity (1).
export function adjacentNumber(value: number, direction: number): number {
    assert.ok(Number.isFinite(value));
    assert.ok(direction === 1 || direction === -1);
    if (value === 0) {
        return direction * Number.MIN_VALUE;
    }
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0);
    // Away from zero is one more in the bits of the magnitude, towards zero one less.
    const awayFromZero = (value > 0) === (direction > 0);
    view.setBigUint64(0, awayFromZero ? bits + 1n : bits - 1n);
    const adjacent = view.getFloat64(0);
    assert.ok(direction > 0 ? adjacent > value : adjacent < value);
    return adjacent;
}

// Adds a value unless the list already holds it. Values compare as `Object.is` compares them, so
// minus zero is kept apart from zero, as the boundary values keep it.
export function addDistinct<T>(list: T[], value: T): void {
    for (const earlier of list) {
        if (Object.is(earlier, value)) {
            return;
        }
    }
    list.push(value);
}
