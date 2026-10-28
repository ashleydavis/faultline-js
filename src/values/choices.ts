// Which value each parameter of a function is given in each call, as data.
//
// A choice names one value that can be built for a parameter by where it comes from and an index,
// so a replay token can carry the values a call used. A call specification is one choice per
// parameter. This file turns the choices of each parameter into the calls a function is made with,
// and knows nothing about types.

import assert from "node:assert/strict";

// Where a value comes from: the fixed list of boundary values for its type, the seeded generator,
// the values read from the conditions in the function's source, or a value factory.
export type Source = "boundary" | "seeded" | "condition" | "factory";

// One value that can be chosen for a parameter. What the index means depends on the source: a
// position in the boundary list, which of the few seeded values, a position in the list of values
// read from the conditions, or which factory in the order the sim files declare them.
export interface IChoice {
    // Where the value comes from.
    source: Source;

    // Which of the values from that source.
    index: number;
}

// What a call is made with: one choice per parameter, in parameter order.
export type Spec = IChoice[];

// The letter a replay token writes for each source.
const letterBySource: Record<Source, string> = {
    boundary: "b",
    seeded: "s",
    condition: "c",
    factory: "f",
};

// A choice as a replay token writes it: the source's letter, then the index.
export function writeChoice(choice: IChoice): string {
    assert.ok(Number.isInteger(choice.index) && choice.index >= 0);
    return `${letterBySource[choice.source]}${choice.index}`;
}

// The choice a replay token's text names, or undefined when the text is not a letter followed by a
// whole number.
export function readChoice(text: string): IChoice | undefined {
    const matched = /^([bscf])(0|[1-9][0-9]*)$/.exec(text);
    if (matched === null) {
        return undefined;
    }
    const index = Number(matched[2]);
    if (!Number.isSafeInteger(index)) {
        return undefined;
    }
    // The pattern admits only the letters in the table.
    const source = sourceByLetter.get(matched[1]!);
    assert.ok(source !== undefined);
    return {
        source,
        index,
    };
}

// The source each letter of a replay token names.
const sourceByLetter = new Map<string, Source>(
    Object.entries(letterBySource).map(([source, letter]) => [letter, sourceNamed(source)]),
);

// The source a key of the letter table names. The table's keys are the sources, so every key is one.
export function sourceNamed(name: string): Source {
    assert.ok(name === "boundary" || name === "seeded" || name === "condition" || name === "factory");
    return name;
}

//
// The calls a function is made with, for a function whose parameters have the choices in `lists`
// (one list per parameter, the first choice of each being its baseline): the baseline, then every
// other choice of each parameter in turn with the others at their baseline. One parameter is varied
// at a time rather than every combination, because the number of combinations is the product of
// the list lengths: on 2026-10-26 one function of a real project had 34 choices for each of three
// parameters, 39,304 combinations, and changing one parameter at a time reached the same code
// paths in a tenth of the calls. When a parameter has no choice the function cannot be called and
// the list is empty. A function with no parameters has one specification with no choices.
//
export function generateSpecs(lists: readonly (readonly IChoice[])[]): Spec[] {
    for (const list of lists) {
        if (list.length === 0) {
            return [];
        }
    }
    const baseline = lists.map((list) => list[0]!);
    const specs: Spec[] = [baseline];
    lists.forEach((list, position) => {
        for (const choice of list.slice(1)) {
            const changed = [...baseline];
            changed[position] = choice;
            specs.push(changed);
        }
    });
    assert.equal(specs.length, lists.reduce((count, list) => count + list.length - 1, 1));
    assert.ok(specs.every((spec) => spec.length === lists.length));
    return specs;
}

// Whether two specifications name the same choices.
export function isSameSpec(first: Spec, second: Spec): boolean {
    if (first.length !== second.length) {
        return false;
    }
    for (let position = 0; position < first.length; position += 1) {
        if (first[position]!.source !== second[position]!.source) {
            return false;
        }
        if (first[position]!.index !== second[position]!.index) {
            return false;
        }
    }
    return true;
}
