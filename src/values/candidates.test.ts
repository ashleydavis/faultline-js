// Checks the values read from a function's conditions, kind by kind.
//
// Each test hands `candidatesOf` conditions written out as the condition reader gives them and
// checks which values come back, in which order, with no repeats.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import type { Condition, ConditionLiteral } from "../discover/conditions.ts";
import { addDistinct, addNumberSides, addStringSides, adjacentNumber, candidatesOf, nearMiss } from "./candidates.ts";

// A condition of `kind` testing against `literal`, on line one.
function conditionOf(kind: Condition["kind"], literal: ConditionLiteral | undefined): Condition {
    return {
        line: 1,
        kind,
        literal,
        subject: "x",
    };
}

test("a number tested against gives the number and one on each side", () => {
    const found = candidatesOf([conditionOf("comparison", {
        kind: "number",
        value: 100,
    })]);
    assert.deepEqual(found.numbers, [100, 99, 101]);
    assert.deepEqual(found.strings, []);
});

test("a fraction tested against gives the fraction and the next double on each side", () => {
    const found = candidatesOf([conditionOf("comparison", {
        kind: "number",
        value: 0.5,
    })]);
    assert.equal(found.numbers.length, 3);
    assert.equal(found.numbers[0], 0.5);
    assert.ok(found.numbers[1]! < 0.5 && found.numbers[1]! > 0.4999999);
    assert.ok(found.numbers[2]! > 0.5 && found.numbers[2]! < 0.5000001);
});

test("a number that is not finite gives no candidate", () => {
    const numbers: number[] = [];
    addNumberSides(numbers, Number.POSITIVE_INFINITY);
    addNumberSides(numbers, Number.NaN);
    assert.deepEqual(numbers, []);
});

test("a string tested against gives the string and a near miss", () => {
    const found = candidatesOf([conditionOf("comparison", {
        kind: "string",
        value: "stop",
    })]);
    assert.deepEqual(found.strings, ["stop", "stoq"]);
});

test("a prefix test also gives the prefix and its near miss with a character after", () => {
    const found = candidatesOf([conditionOf("starts-with", {
        kind: "string",
        value: "v",
    })]);
    assert.deepEqual(found.strings, ["v", "w", "va", "wa"]);
});

test("a suffix test also gives the suffix and its near miss with a character before", () => {
    const found = candidatesOf([conditionOf("ends-with", {
        kind: "string",
        value: ".ts",
    })]);
    assert.deepEqual(found.strings, [".ts", ".tr", "a.ts", "a.tr"]);
});

test("a case, an includes and a comparison each give their strings, in the order of the conditions", () => {
    const strings: string[] = [];
    addStringSides(strings, "b", "case");
    addStringSides(strings, "a", "includes");
    assert.deepEqual(strings, ["b", "c", "a", "`"]);
});

test("a bigint tested against gives the bigint and one on each side", () => {
    const found = candidatesOf([conditionOf("comparison", {
        kind: "bigint",
        value: "10",
    })]);
    assert.deepEqual(found.bigints, [10n, 9n, 11n]);
});

test("a boolean tested against gives the boolean", () => {
    const found = candidatesOf([
        conditionOf("comparison", {
            kind: "boolean",
            value: true,
        }),
        conditionOf("comparison", {
            kind: "boolean",
            value: false,
        }),
        conditionOf("comparison", {
            kind: "boolean",
            value: true,
        }),
    ]);
    assert.deepEqual(found.booleans, [true, false]);
});

test("typeof, in, instanceof, null and undefined conditions give no candidate", () => {
    const found = candidatesOf([
        conditionOf("typeof", {
            kind: "string",
            value: "number",
        }),
        conditionOf("in", {
            kind: "string",
            value: "key",
        }),
        conditionOf("instanceof", undefined),
        conditionOf("comparison", {
            kind: "null",
            value: undefined,
        }),
        conditionOf("comparison", {
            kind: "undefined",
            value: undefined,
        }),
    ]);
    assert.deepEqual(found, {
        numbers: [],
        strings: [],
        bigints: [],
        booleans: [],
    });
});

test("a value given by two conditions is listed once", () => {
    const found = candidatesOf([
        conditionOf("comparison", {
            kind: "number",
            value: 1,
        }),
        conditionOf("case", {
            kind: "number",
            value: 2,
        }),
    ]);
    assert.deepEqual(found.numbers, [1, 0, 2, 3]);
});

test("a near miss is as long as the string and differs from it, and the empty string's is one character", () => {
    assert.equal(nearMiss(""), "a");
    assert.equal(nearMiss("a"), "`");
    assert.equal(nearMiss("ab"), "ac");
});

test("the adjacent number of zero is the smallest double on that side", () => {
    assert.equal(adjacentNumber(0, 1), Number.MIN_VALUE);
    assert.equal(adjacentNumber(0, -1), -Number.MIN_VALUE);
});

test("the adjacent number moves towards the direction given on both sides of zero", () => {
    assert.equal(adjacentNumber(1, 1), 1 + Number.EPSILON);
    assert.equal(adjacentNumber(1, -1), 1 - Number.EPSILON / 2);
    assert.equal(adjacentNumber(-1, -1), -1 - Number.EPSILON);
    assert.equal(adjacentNumber(-1, 1), -1 + Number.EPSILON / 2);
});

test("an adjacent number of something not finite, or in no direction, is refused", () => {
    assert.throws(() => adjacentNumber(Number.NaN, 1));
    assert.throws(() => adjacentNumber(1, 0));
});

test("a value is added once, and minus zero is kept apart from zero", () => {
    const numbers: number[] = [];
    addDistinct(numbers, 0);
    addDistinct(numbers, 0);
    addDistinct(numbers, -0);
    addDistinct(numbers, Number.NaN);
    addDistinct(numbers, Number.NaN);
    assert.equal(numbers.length, 3);
    assert.ok(Object.is(numbers[1], -0));
});
