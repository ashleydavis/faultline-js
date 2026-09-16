import assert from "node:assert/strict";
import test from "node:test";
import { elapsed, numberWord, padded, percentageOf, plural } from "./style.ts";

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
