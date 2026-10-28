// Checks how choices are written for a replay token and read back, and that the baseline and each
// parameter's other choices one at a time are listed once, in the order the run calls them.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { generateSpecs, isSameSpec, readChoice, sourceNamed, writeChoice, type IChoice } from "./choices.ts";

// The choice from `source` at `index`.
function choiceOf(source: IChoice["source"], index: number): IChoice {
    return {
        source,
        index,
    };
}

// A specification written as a replay token writes its choices, for comparing whole lists.
function written(specs: IChoice[][]): string[] {
    return specs.map((spec) => spec.map((choice) => writeChoice(choice)).join(","));
}

test("each source is written as its letter followed by the index", () => {
    assert.equal(writeChoice(choiceOf("boundary", 0)), "b0");
    assert.equal(writeChoice(choiceOf("seeded", 3)), "s3");
    assert.equal(writeChoice(choiceOf("condition", 12)), "c12");
    assert.equal(writeChoice(choiceOf("factory", 1)), "f1");
});

test("a choice that is not a whole number at or above zero cannot be written", () => {
    assert.throws(() => writeChoice(choiceOf("boundary", -1)));
    assert.throws(() => writeChoice(choiceOf("boundary", 1.5)));
});

test("a written choice reads back as the same choice", () => {
    for (const choice of [choiceOf("boundary", 0), choiceOf("seeded", 3), choiceOf("condition", 12), choiceOf("factory", 1)]) {
        assert.deepEqual(readChoice(writeChoice(choice)), choice);
    }
});

test("text that is not a letter and a whole number reads as no choice", () => {
    for (const text of ["", "b", "x1", "b-1", "b01", "b1.5", "B1", "b1 ", "b99999999999999999999"]) {
        assert.equal(readChoice(text), undefined, text);
    }
});

test("every source name is a source, and any other name is refused", () => {
    assert.equal(sourceNamed("factory"), "factory");
    assert.throws(() => sourceNamed("other"));
});

test("a function with no parameters is called once with no choices", () => {
    assert.deepEqual(generateSpecs([]), [[]]);
});

test("a parameter with no choice leaves the function with no call", () => {
    assert.deepEqual(generateSpecs([[choiceOf("boundary", 0)], []]), []);
});

test("the baseline comes first, then one parameter changed at a time", () => {
    const first = [choiceOf("boundary", 0), choiceOf("boundary", 1), choiceOf("seeded", 0)];
    const second = [choiceOf("boundary", 0), choiceOf("condition", 0)];
    const specs = generateSpecs([first, second]);
    assert.deepEqual(written(specs), [
        "b0,b0",
        "b1,b0",
        "s0,b0",
        "b0,c0",
    ]);
});

test("three parameters give each choice of each parameter once, with no combination changing two", () => {
    const lists = [
        [choiceOf("boundary", 0), choiceOf("boundary", 1)],
        [choiceOf("boundary", 0), choiceOf("boundary", 1), choiceOf("boundary", 2)],
        [choiceOf("factory", 0), choiceOf("factory", 1)],
    ];
    const specs = written(generateSpecs(lists));
    assert.deepEqual(specs, ["b0,b0,f0", "b1,b0,f0", "b0,b1,f0", "b0,b2,f0", "b0,b0,f1"]);
});

test("two specifications are the same only when every choice is", () => {
    const spec = [choiceOf("boundary", 0), choiceOf("seeded", 1)];
    assert.equal(isSameSpec(spec, [choiceOf("boundary", 0), choiceOf("seeded", 1)]), true);
    assert.equal(isSameSpec(spec, [choiceOf("boundary", 0)]), false);
    assert.equal(isSameSpec(spec, [choiceOf("condition", 0), choiceOf("seeded", 1)]), false);
    assert.equal(isSameSpec(spec, [choiceOf("boundary", 0), choiceOf("seeded", 2)]), false);
});
