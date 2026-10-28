//
// Tests how the report is written. Goal: counts read as words, nouns take their plural, the
// percentage is rounded down, names line up and times read the way a person reads them back.
// Method: call each helper with values written out in each test and compare what it gives.
//
import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { elapsed, numberWord, padded, percentageOf, plural, runTimeText } from "./style.ts";

test("a small count is written as a word, so a line reads as a sentence", () => {
    assert.equal(numberWord(0), "No");
    assert.equal(numberWord(1), "One");
    assert.equal(numberWord(4), "Four");
    assert.equal(numberWord(12), "Twelve");
});

test("a count past the words is written as digits", () => {
    assert.equal(numberWord(13), "13");
    assert.equal(numberWord(100), "100");
});

test("a noun takes its plural from the count in front of it", () => {
    assert.equal(plural(1, "path", "paths"), "path");
    assert.equal(plural(0, "path", "paths"), "paths");
    assert.equal(plural(2, "path", "paths"), "paths");
});

test("the percentage is rounded down, so one path short never reads as a hundred", () => {
    assert.equal(percentageOf(999, 1000), 99);
    assert.equal(percentageOf(2, 3), 66);
    assert.equal(percentageOf(1000, 1000), 100);
    assert.equal(percentageOf(0, 3), 0);
});

test("no path at all reads as a hundred, because none was missed", () => {
    assert.equal(percentageOf(0, 0), 100);
});

test("a name is padded out so the counts beside it line up", () => {
    assert.equal(padded("a", 4), "a   ");
    assert.equal(padded("abcd", 4), "abcd ");
    assert.equal(padded("abcdef", 4), "abcdef ");
});

test("how long a run took reads the way somebody says it", () => {
    assert.equal(elapsed(0), "0s");
    assert.equal(elapsed(999), "0s");
    assert.equal(elapsed(1000), "1s");
    assert.equal(elapsed(59000), "59s");
    assert.equal(elapsed(60000), "1m 0s");
    assert.equal(elapsed(125000), "2m 5s");
});

describe("runTimeText", () => {
    test("a run's time keeps its milliseconds under a minute and reads as elapsed time from a minute up", () => {
        assert.equal(runTimeText(0), "0ms");
        assert.equal(runTimeText(250), "250ms");
        assert.equal(runTimeText(9120), "9s 120ms");
        assert.equal(runTimeText(61000), "1m 1s");
    });

    test("a run's time that is not a whole number of milliseconds from 0 up is a mistake in the caller", () => {
        assert.throws(() => runTimeText(-1), assert.AssertionError);
        assert.throws(() => runTimeText(1.5), assert.AssertionError);
    });
});
