// Lists the values each parameter of a function can be given and builds the value for one choice.
//
// A parameter's choices come in the order boundary values, seeded values, values read from the
// conditions, value factories. A type a value factory exists for takes only its factories, the first
// one written being the baseline. Every other type is built from its recipe: a value made of other
// values (an object, a tuple, a map) steps its parts through their own lists together, so the
// number of boundary values of the whole is that of its largest part rather than the product of
// them all. Every value is a pure function of the recipe, the choice, the run's seed and the
// parameter's position, so the same choice always builds the same value and a call is replayed from
// its choices.

import assert from "node:assert/strict";
import type { Condition } from "../discover/conditions.ts";
import type { ParameterInfo } from "../discover/functions.ts";
import { leafKey, type Property, type Recipe } from "../discover/recipes.ts";
import type { SeededRng } from "../world/random.ts";
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
    longestSeededLength,
    seededBigint,
    seededBoolean,
    seededCount,
    seededDateMs,
    seededNumber,
    seededRngFor,
    seededString,
} from "./boundary.ts";
import { candidatesOf, type ICandidates } from "./candidates.ts";
import { generateSpecs, type IChoice, type Spec } from "./choices.ts";
import type { IFactoryTable } from "./factories.ts";
import { passedInFunction } from "./passed-in.ts";

// What building the values of one function's calls is wired to.
export interface IValueContext {
    // The run's seed, which every seeded value is drawn from.
    seed: number;

    // The values read from the function's conditions.
    candidates: ICandidates;

    // The value factories of the function's sim files.
    factories: IFactoryTable;

    // The keys of the types whose factory is being called right now. A factory that takes a value
    // of the type it returns is given one built from the type's own properties, because asking the
    // same factory for it would never end.
    making: string[];

    // How many boundary values each recipe has, worked out once. A recipe is a graph that shares
    // the types many properties hold, and counting it afresh at every level would take time that
    // grows with the number of ways to reach each type.
    boundaryCounts: Map<Recipe, number>;

    // How many values the conditions give each recipe, worked out once for the same reason.
    conditionCounts: Map<Recipe, number>;
}

// What a value of type `any` or `unknown` is tried as: each kind of value JavaScript has, so code
// that checks with `typeof` or `Array.isArray` which kind it was given has each to check.
const anyRecipe: Recipe = {
    kind: "union",
    options: [
        {
            kind: "undefined",
        },
        {
            kind: "null",
        },
        {
            kind: "boolean",
        },
        {
            kind: "number",
        },
        {
            kind: "string",
        },
        {
            kind: "object",
            properties: [],
        },
        {
            kind: "array",
            element: {
                kind: "number",
            },
        },
    ],
};

// The key an object built from an index signature gets its one entry under, when it gets one. A one
// character string, as the shortest boundary string is.
const indexKey = "a";

// Wires the values of one function's calls to the run's seed, the function's conditions and the
// factories of its sim files.
export function createValueContext(seed: number, conditions: readonly Condition[], factories: IFactoryTable): IValueContext {
    assert.ok(Number.isInteger(seed));
    return {
        seed,
        candidates: candidatesOf(conditions),
        factories,
        making: [],
        boundaryCounts: new Map(),
        conditionCounts: new Map(),
    };
}

// The context a factory's own parameters are built in: the same one with the factory's key added
// to the ones being made, and counts of its own, because a type whose factory is being made is
// counted from its own properties.
export function contextMaking(context: IValueContext, key: string): IValueContext {
    assert.ok(!context.making.includes(key));
    return {
        ...context,
        making: [...context.making, key],
        boundaryCounts: new Map(),
        conditionCounts: new Map(),
    };
}

// The recipe a parameter's values are built from. An optional parameter whose type does not already
// allow `undefined` is also tried left out, which is what passing `undefined` does.
export function parameterRecipe(parameter: ParameterInfo): Recipe {
    if (!parameter.optional || parameter.rest || allowsUndefined(parameter.recipe)) {
        return parameter.recipe;
    }
    return {
        kind: "union",
        options: [
            {
                kind: "undefined",
            },
            parameter.recipe,
        ],
    };
}

// Whether `undefined` is already one of a recipe's values.
export function allowsUndefined(recipe: Recipe): boolean {
    if (recipe.kind === "undefined" || recipe.kind === "void" || recipe.kind === "any") {
        return true;
    }
    if (recipe.kind === "union") {
        return recipe.options.some((option) => allowsUndefined(option));
    }
    return false;
}

// How many factories build the type a named recipe names, as this context may use them.
export function factoryCount(context: IValueContext, key: string): number {
    if (context.making.includes(key)) {
        return 0;
    }
    return context.factories.count(key);
}

// How many boundary values a recipe has. A recipe with none cannot be built at all.
export function boundaryCount(context: IValueContext, recipe: Recipe): number {
    const known = context.boundaryCounts.get(recipe);
    if (known !== undefined) {
        return known;
    }
    const counted = countBoundary(context, recipe);
    assert.ok(Number.isInteger(counted) && counted >= 0);
    context.boundaryCounts.set(recipe, counted);
    return counted;
}

// Counts the boundary values of a recipe: the fixed list for a leaf type, the sum of the sides for
// a union, the largest part for a value made of parts, and one more than what it holds for a
// collection, whose empty one comes first.
export function countBoundary(context: IValueContext, recipe: Recipe): number {
    const leafFactories = leafFactoryCount(context, recipe);
    if (leafFactories > 0) {
        return leafFactories;
    }
    switch (recipe.kind) {
        case "any":
            return boundaryCount(context, anyRecipe);
        case "string":
            return boundaryStrings.length;
        case "number":
            return boundaryNumbers.length;
        case "bigint":
            return boundaryBigints.length;
        case "boolean":
            return boundaryBooleans.length;
        case "null":
        case "undefined":
        case "void":
        case "literal":
        case "regexp":
            return 1;
        case "never":
        case "unknown":
            return 0;
        case "effect":
            // A signal is tried live and already aborted. A scenario or expectation context is
            // handed over by the run and never built as a value.
            return recipe.effect === "signal" ? 2 : 0;
        case "union":
            return sum(recipe.options.map((option) => boundaryCount(context, option)));
        case "array":
        case "set":
            return 1 + boundaryCount(context, recipe.element);
        case "map":
            return 1 + mapPartCount(boundaryCount(context, recipe.key), boundaryCount(context, recipe.value));
        case "tuple":
            return partsCount(recipe.elements.map((element) => boundaryCount(context, element)));
        case "object":
            return objectCount(context, recipe, (part) => boundaryCount(context, part));
        case "date":
            return boundaryDateMs.length;
        case "url":
            return boundaryUrls.length;
        case "bytes":
            return boundaryByteLengths.length;
        case "error":
            return boundaryStrings.length;
        case "promise":
            return boundaryCount(context, recipe.value);
        case "function":
            return boundaryCount(context, recipe.returns);
        case "named": {
            const factories = factoryCount(context, recipe.key);
            if (factories > 0) {
                return factories;
            }
            return boundaryCount(context, recipe.structural);
        }
    }
}

// How many values a map's one entry can be built with: as many as the larger of its key and value,
// or none when either cannot be built, which leaves the map only its empty value.
export function mapPartCount(keyCount: number, valueCount: number): number {
    if (keyCount === 0 || valueCount === 0) {
        return 0;
    }
    return Math.max(keyCount, valueCount);
}

// How many values a value made of required parts has: as many as its largest part, or none when a
// part cannot be built. A value with no parts has one.
export function partsCount(counts: readonly number[]): number {
    if (counts.some((count) => count === 0)) {
        return 0;
    }
    return Math.max(1, ...counts);
}

// How many values an object has, counted from its parts with `count`. A required property that
// cannot be built leaves the object unbuildable. An optional property adds the value with it left
// out, which comes first, and so does an index signature, whose value with no entry comes first.
export function objectCount(context: IValueContext, recipe: Recipe & { kind: "object" }, count: (part: Recipe) => number): number {
    const counts: number[] = [];
    for (const property of recipe.properties) {
        const held = count(property.recipe);
        if (property.optional) {
            counts.push(1 + held);
            continue;
        }
        if (boundaryCount(context, property.recipe) === 0) {
            return 0;
        }
        counts.push(held);
    }
    if (recipe.index !== undefined) {
        counts.push(1 + count(recipe.index));
    }
    return Math.max(1, ...counts);
}

// How many values the conditions give a recipe: the candidates of its type for a number, a string,
// a bigint or a boolean, the sum of the sides for a union, the largest part for a value made of
// parts, and what it holds for a collection. Every other recipe gets none.
export function conditionCount(context: IValueContext, recipe: Recipe): number {
    const known = context.conditionCounts.get(recipe);
    if (known !== undefined) {
        return known;
    }
    const counted = countCondition(context, recipe);
    assert.ok(Number.isInteger(counted) && counted >= 0);
    context.conditionCounts.set(recipe, counted);
    return counted;
}

// Counts the values the conditions give a recipe. See `conditionCount`.
export function countCondition(context: IValueContext, recipe: Recipe): number {
    if (boundaryCount(context, recipe) === 0) {
        return 0;
    }
    if (leafFactoryCount(context, recipe) > 0) {
        return 0;
    }
    switch (recipe.kind) {
        case "any":
            return conditionCount(context, anyRecipe);
        case "string":
            return context.candidates.strings.length;
        case "number":
            return context.candidates.numbers.length;
        case "bigint":
            return context.candidates.bigints.length;
        case "boolean":
            return context.candidates.booleans.length;
        case "union":
            return sum(recipe.options.map((option) => conditionCount(context, option)));
        case "array":
        case "set":
            return conditionCount(context, recipe.element);
        case "map":
            return Math.max(conditionCount(context, recipe.key), conditionCount(context, recipe.value));
        case "tuple":
            return Math.max(0, ...recipe.elements.map((element) => conditionCount(context, element)));
        case "object":
            return objectConditionCount(context, recipe);
        case "promise":
            return conditionCount(context, recipe.value);
        case "function":
            return conditionCount(context, recipe.returns);
        case "named":
            if (factoryCount(context, recipe.key) > 0) {
                return 0;
            }
            return conditionCount(context, recipe.structural);
        default:
            return 0;
    }
}

// How many values the conditions give an object: as many as its part given the most. An optional
// part, and an index signature, given any also has its value left out, first, as in `buildObject`.
// An object none of whose parts the conditions give a value gets none.
export function objectConditionCount(context: IValueContext, recipe: Recipe & { kind: "object" }): number {
    const counts: number[] = [];
    for (const property of recipe.properties) {
        const held = conditionCount(context, property.recipe);
        counts.push(property.optional && held > 0 ? 1 + held : held);
    }
    if (recipe.index !== undefined) {
        const held = conditionCount(context, recipe.index);
        counts.push(held > 0 ? 1 + held : 0);
    }
    return Math.max(0, ...counts);
}

// Whether the seeded generator can make two values of a recipe differ. A recipe with one value
// whatever the seed (a literal, `null`, an object of literals) is not offered seeded values, which
// would only repeat the same call.
export function isSeedVarying(context: IValueContext, recipe: Recipe): boolean {
    if (boundaryCount(context, recipe) === 0) {
        return false;
    }
    const leafFactories = leafFactoryCount(context, recipe);
    if (leafFactories > 0) {
        return leafFactories > 1;
    }
    switch (recipe.kind) {
        case "null":
        case "undefined":
        case "void":
        case "literal":
        case "regexp":
            return false;
        case "union":
            return buildableOptions(context, recipe.options).length > 1 || recipe.options.some((option) => isSeedVarying(context, option));
        case "array":
        case "set":
            // The length varies whenever an element can be built at all.
            return boundaryCount(context, recipe.element) > 0;
        case "map":
            return mapPartCount(boundaryCount(context, recipe.key), boundaryCount(context, recipe.value)) > 0;
        case "tuple":
            return recipe.elements.some((element) => isSeedVarying(context, element));
        case "object":
            return objectIsSeedVarying(context, recipe);
        case "promise":
            return isSeedVarying(context, recipe.value);
        case "function":
            return isSeedVarying(context, recipe.returns);
        case "named": {
            const factories = factoryCount(context, recipe.key);
            if (factories > 0) {
                return factories > 1;
            }
            return isSeedVarying(context, recipe.structural);
        }
        default:
            return true;
    }
}

// Whether a seeded object can differ from one seed to the next: an optional property is left out
// or given, an index signature gets entries or none, and a property may vary itself.
export function objectIsSeedVarying(context: IValueContext, recipe: Recipe & { kind: "object" }): boolean {
    if (recipe.index !== undefined && boundaryCount(context, recipe.index) > 0) {
        return true;
    }
    for (const property of recipe.properties) {
        if (property.optional && boundaryCount(context, property.recipe) > 0) {
            return true;
        }
        if (isSeedVarying(context, property.recipe)) {
            return true;
        }
    }
    return false;
}

// Whether two values of a recipe can be compared with `Object.is`, which is what lets a list of
// choices drop one that builds a value an earlier choice already built.
export function isComparable(recipe: Recipe): boolean {
    switch (recipe.kind) {
        case "string":
        case "number":
        case "bigint":
        case "boolean":
        case "null":
        case "undefined":
        case "void":
        case "literal":
            return true;
        case "union":
            return recipe.options.every((option) => isComparable(option));
        default:
            return false;
    }
}

// The options of a union that can be built, in the order the union lists them.
export function buildableOptions(context: IValueContext, options: readonly Recipe[]): Recipe[] {
    return options.filter((option) => boundaryCount(context, option) > 0);
}

// Builds the boundary value at `index` of a recipe.
export function buildBoundary(context: IValueContext, recipe: Recipe, index: number): unknown {
    const count = boundaryCount(context, recipe);
    assert.ok(count > 0, `No value can be built for a ${recipe.kind}.`);
    assert.ok(Number.isInteger(index) && index >= 0 && index < count, `There is no boundary value ${index} of a ${recipe.kind}.`);
    const leaf = leafKey(recipe);
    if (leaf !== undefined) {
        if (leafFactoryCount(context, recipe) > 0) {
            return makeWithFactory(context, leaf, index);
        }
    }
    switch (recipe.kind) {
        case "any":
            return buildBoundary(context, anyRecipe, index);
        case "string":
            return boundaryStrings[index];
        case "number":
            return boundaryNumbers[index];
        case "bigint":
            return boundaryBigints[index];
        case "boolean":
            return boundaryBooleans[index];
        case "null":
            return null;
        case "literal":
            return recipe.value;
        case "regexp":
            return new RegExp("a", "");
        case "effect":
            return index === 0 ? new AbortController().signal : AbortSignal.abort();
        case "union": {
            const found = unionSide(context, recipe.options, index, (option) => boundaryCount(context, option));
            return buildBoundary(context, found.option, found.index);
        }
        case "array":
            return index === 0 ? [] : [buildBoundary(context, recipe.element, index - 1)];
        case "set":
            return index === 0 ? new Set() : new Set([buildBoundary(context, recipe.element, index - 1)]);
        case "map": {
            if (index === 0) {
                return new Map();
            }
            const key = buildBoundary(context, recipe.key, (index - 1) % boundaryCount(context, recipe.key));
            const value = buildBoundary(context, recipe.value, (index - 1) % boundaryCount(context, recipe.value));
            return new Map([[key, value]]);
        }
        case "tuple":
            return recipe.elements.map((element) => buildBoundary(context, element, index % boundaryCount(context, element)));
        case "object":
            return buildObject(context, recipe, index, (part, partIndex) => buildBoundary(context, part, partIndex), (part) => boundaryCount(context, part));
        case "date":
            return new Date(boundaryDateMs[index]!);
        case "url":
            return new URL(boundaryUrls[index]!);
        case "bytes":
            return bytesOf(recipe.name, new Uint8Array(boundaryByteLengths[index]!));
        case "error":
            return errorOf(recipe.name, boundaryStrings[index]!);
        case "promise":
            return Promise.resolve(buildBoundary(context, recipe.value, index));
        case "function": {
            const returns = recipe.returns;
            return passedInFunction(returns.kind === "promise", {
                build: () => buildBoundary(context, returns, index),
            });
        }
        case "named":
            if (factoryCount(context, recipe.key) > 0) {
                return makeWithFactory(context, recipe.key, index);
            }
            return buildBoundary(context, recipe.structural, index);
        default:
            // `undefined` and `void`.
            return undefined;
    }
}

// Which side of a union the value at `index` comes from, and its index within that side, when the
// sides' values are laid end to end in the order the union lists them. `count` says how many values
// each side has from the source being read.
export function unionSide(context: IValueContext, options: readonly Recipe[], index: number, count: (option: Recipe) => number): IUnionSide {
    let offset = 0;
    let at = 0;
    while (index >= offset + count(options[at]!)) {
        offset += count(options[at]!);
        at += 1;
        assert.ok(at < options.length, `A union has no value ${index}; its sides have ${offset}.`);
    }
    return {
        option: options[at]!,
        index: index - offset,
    };
}

// One side of a union and an index within it.
export interface IUnionSide {
    // The side.
    option: Recipe;

    // The index of the value within that side.
    index: number;
}

// Builds an object whose parts step through their own lists together: part `index` modulo how many
// the part has. An optional property's slot zero leaves it out, and so does an index signature's,
// which otherwise gets one entry. `build` builds a part's value at an index and `count` says how
// many values a part has from the source being read; a part with none from that source is given its
// first boundary value, or left out when it is optional.
export function buildObject(
    context: IValueContext,
    recipe: Recipe & { kind: "object" },
    index: number,
    build: (part: Recipe, partIndex: number) => unknown,
    count: (part: Recipe) => number,
): Record<string, unknown> {
    const built: Record<string, unknown> = {};
    for (const property of recipe.properties) {
        const value = buildPart(context, property, index, build, count);
        if (value.given) {
            built[property.name] = value.value;
        }
    }
    if (recipe.index !== undefined && !recipe.properties.some((property) => property.name === indexKey)) {
        const entry = buildPart(context, {
            name: indexKey,
            recipe: recipe.index,
            optional: true,
        }, index, build, count);
        if (entry.given) {
            built[indexKey] = entry.value;
        }
    }
    return built;
}

// A part of an object as it was built: whether it was given at all and, when it was, its value.
export interface IBuiltPart {
    // Whether the part is given, as against left out.
    given: boolean;

    // Its value, when it is given.
    value: unknown;
}

// Builds one property of an object for the object's index. See `buildObject`.
export function buildPart(
    context: IValueContext,
    property: Property,
    index: number,
    build: (part: Recipe, partIndex: number) => unknown,
    count: (part: Recipe) => number,
): IBuiltPart {
    const held = count(property.recipe);
    if (property.optional) {
        const slot = index % (1 + held);
        if (slot === 0) {
            return {
                given: false,
                value: undefined,
            };
        }
        return {
            given: true,
            value: build(property.recipe, slot - 1),
        };
    }
    if (held === 0) {
        return {
            given: true,
            value: buildBoundary(context, property.recipe, 0),
        };
    }
    return {
        given: true,
        value: build(property.recipe, index % held),
    };
}

// Builds the value at `index` of those the conditions give a recipe.
export function buildCondition(context: IValueContext, recipe: Recipe, index: number): unknown {
    const count = conditionCount(context, recipe);
    assert.ok(Number.isInteger(index) && index >= 0 && index < count, `The conditions give no value ${index} of a ${recipe.kind}.`);
    // A part the conditions give no value is built from its boundary values instead.
    const part = (inner: Recipe, partIndex: number): unknown => {
        const held = conditionCount(context, inner);
        if (held === 0) {
            return buildBoundary(context, inner, 0);
        }
        return buildCondition(context, inner, partIndex % held);
    };
    switch (recipe.kind) {
        case "any":
            return buildCondition(context, anyRecipe, index);
        case "string":
            return context.candidates.strings[index];
        case "number":
            return context.candidates.numbers[index];
        case "bigint":
            return context.candidates.bigints[index];
        case "boolean":
            return context.candidates.booleans[index];
        case "union": {
            const found = unionSide(context, recipe.options, index, (option) => conditionCount(context, option));
            return buildCondition(context, found.option, found.index);
        }
        case "array":
            return [buildCondition(context, recipe.element, index)];
        case "set":
            return new Set([buildCondition(context, recipe.element, index)]);
        case "map":
            return new Map([[part(recipe.key, index), part(recipe.value, index)]]);
        case "tuple":
            return recipe.elements.map((element) => part(element, index));
        case "object":
            return buildObject(context, recipe, index, part, (inner) => conditionCount(context, inner));
        case "promise":
            return Promise.resolve(buildCondition(context, recipe.value, index));
        case "function": {
            const returns = recipe.returns;
            return passedInFunction(returns.kind === "promise", {
                build: () => buildCondition(context, returns, index),
            });
        }
        default:
            // A named type with no factory is the only recipe left that the conditions give values.
            assert.ok(recipe.kind === "named");
            return buildCondition(context, recipe.structural, index);
    }
}

// Builds one seeded value of a recipe, drawing every choice from `rng`. `depth` is how many
// collections the value is inside: each level halves the longest length the generator builds, so a
// list of lists of lists stays small.
export function buildSeeded(context: IValueContext, recipe: Recipe, rng: SeededRng, depth: number): unknown {
    assert.ok(boundaryCount(context, recipe) > 0, `No value can be built for a ${recipe.kind}.`);
    const longest = longestSeededLength >> depth;
    const leaf = leafKey(recipe);
    if (leaf !== undefined) {
        const leafFactories = leafFactoryCount(context, recipe);
        if (leafFactories > 0) {
            return makeWithFactory(context, leaf, rng.int(0, leafFactories - 1));
        }
    }
    switch (recipe.kind) {
        case "any":
            return buildSeeded(context, anyRecipe, rng, depth);
        case "string":
            return seededString(rng);
        case "number":
            return seededNumber(rng);
        case "bigint":
            return seededBigint(rng);
        case "boolean":
            return seededBoolean(rng);
        case "null":
            return null;
        case "literal":
            return recipe.value;
        case "regexp":
            return new RegExp("a", "");
        case "effect":
            return seededBoolean(rng) ? AbortSignal.abort() : new AbortController().signal;
        case "union":
            return buildSeeded(context, rng.pick(buildableOptions(context, recipe.options)), rng, depth);
        case "array":
            return seededElements(context, recipe.element, rng, depth, longest);
        case "set":
            return new Set(seededElements(context, recipe.element, rng, depth, longest));
        case "map": {
            const built = new Map<unknown, unknown>();
            if (mapPartCount(boundaryCount(context, recipe.key), boundaryCount(context, recipe.value)) === 0) {
                return built;
            }
            const length = rng.int(0, longest);
            for (let entry = 0; entry < length; entry += 1) {
                built.set(buildSeeded(context, recipe.key, rng, depth + 1), buildSeeded(context, recipe.value, rng, depth + 1));
            }
            return built;
        }
        case "tuple":
            return recipe.elements.map((element) => buildSeeded(context, element, rng, depth));
        case "object":
            return buildSeededObject(context, recipe, rng, depth, longest);
        case "date":
            return new Date(seededDateMs(rng));
        case "url":
            return new URL(rng.pick(boundaryUrls));
        case "bytes":
            return bytesOf(recipe.name, rng.bytes(rng.int(0, longest)));
        case "error":
            return errorOf(recipe.name, seededString(rng));
        case "promise":
            return Promise.resolve(buildSeeded(context, recipe.value, rng, depth));
        case "function": {
            const returns = recipe.returns;
            return passedInFunction(returns.kind === "promise", {
                build: () => buildSeeded(context, returns, rng, depth),
            });
        }
        case "named": {
            const factories = factoryCount(context, recipe.key);
            if (factories > 0) {
                return makeWithFactory(context, recipe.key, rng.int(0, factories - 1));
            }
            return buildSeeded(context, recipe.structural, rng, depth);
        }
        default:
            // `undefined` and `void`.
            return undefined;
    }
}

// The elements of a seeded list or set: a seeded number of them up to `longest`, or none when the
// element cannot be built.
export function seededElements(context: IValueContext, element: Recipe, rng: SeededRng, depth: number, longest: number): unknown[] {
    const elements: unknown[] = [];
    if (boundaryCount(context, element) === 0) {
        return elements;
    }
    const length = rng.int(0, longest);
    for (let index = 0; index < length; index += 1) {
        elements.push(buildSeeded(context, element, rng, depth + 1));
    }
    return elements;
}

// A seeded object: each optional property left out or given on a coin toss, and up to `longest`
// entries under seeded keys for an index signature.
export function buildSeededObject(context: IValueContext, recipe: Recipe & { kind: "object" }, rng: SeededRng, depth: number, longest: number): Record<string, unknown> {
    const built: Record<string, unknown> = {};
    for (const property of recipe.properties) {
        if (property.optional) {
            if (boundaryCount(context, property.recipe) === 0 || !seededBoolean(rng)) {
                continue;
            }
        }
        built[property.name] = buildSeeded(context, property.recipe, rng, depth);
    }
    const index = recipe.index;
    if (index !== undefined && boundaryCount(context, index) > 0) {
        const entries = rng.int(0, longest);
        for (let entry = 0; entry < entries; entry += 1) {
            const key = seededString(rng);
            if (recipe.properties.some((property) => property.name === key)) {
                continue;
            }
            built[key] = buildSeeded(context, index, rng, depth + 1);
        }
    }
    return built;
}

// Calls the factory at `index` among those for the type with `key`. Its own parameters are given
// their baseline values, built in a context that knows this factory is being made.
export function makeWithFactory(context: IValueContext, key: string, index: number): unknown {
    const inner = contextMaking(context, key);
    return context.factories.make(key, index, {
        build: (parameter) => buildBaseline(inner, parameter),
    });
}

// The baseline value of a parameter: its first choice, or `undefined` when it has none.
export function buildBaseline(context: IValueContext, parameter: ParameterInfo): unknown {
    const recipe = parameterRecipe(parameter);
    const choices = listChoices(context, recipe, 0);
    if (choices.length === 0) {
        return undefined;
    }
    return buildValue(context, recipe, 0, choices[0]!);
}

// Builds the value one choice names for a parameter at `position`.
export function buildValue(context: IValueContext, recipe: Recipe, position: number, choice: IChoice): unknown {
    if (choice.source === "boundary") {
        return buildBoundary(context, recipe, choice.index);
    }
    if (choice.source === "condition") {
        return buildCondition(context, recipe, choice.index);
    }
    if (choice.source === "seeded") {
        assert.ok(choice.index < seededCount, `There is no seeded value ${choice.index}.`);
        return buildSeeded(context, recipe, seededRngFor(context.seed, position, choice.index), 0);
    }
    const key = factoryKey(recipe);
    assert.ok(key !== undefined, "Only a named type or a built-in value type has value factories.");
    assert.ok(choice.index < factoryCount(context, key), `There is no value factory ${choice.index} for ${key}.`);
    return makeWithFactory(context, key, choice.index);
}

// How many value factories build a built-in value type such as a `Date`, as this context may use
// them, or none for a recipe of any other kind. A built-in value type with factories takes only
// their values, wherever it is held, as a named type with factories does, so a `Date` inside an
// object is one of the factories' dates too.
export function leafFactoryCount(context: IValueContext, recipe: Recipe): number {
    const leaf = leafKey(recipe);
    if (leaf === undefined) {
        return 0;
    }
    return factoryCount(context, leaf);
}

// The key the value factories for a recipe's type are found by: a named type's own key, or the key
// `leafKey` gives a built-in value type, or nothing for a type no factory can be written for.
export function factoryKey(recipe: Recipe): string | undefined {
    if (recipe.kind === "named") {
        return recipe.key;
    }
    return leafKey(recipe);
}

// Lists the choices for a parameter at `position` whose values are built from `recipe`, the
// baseline first. A type a value factory exists for gets one choice per factory, in the order the
// sim files declare them. Any other type gets its boundary values, then its seeded values when the
// seed can vary it, then the values its function's conditions give it, dropping a choice that
// builds a value an earlier choice already built when the values can be compared. A type that
// cannot be built gets none.
export function listChoices(context: IValueContext, recipe: Recipe, position: number): IChoice[] {
    const choices: IChoice[] = [];
    const key = factoryKey(recipe);
    if (key !== undefined) {
        const factories = factoryCount(context, key);
        if (factories > 0) {
            for (let index = 0; index < factories; index += 1) {
                choices.push({
                    source: "factory",
                    index,
                });
            }
            return choices;
        }
    }
    const comparable = isComparable(recipe);
    const kept: unknown[] = [];
    const add = (choice: IChoice): void => {
        if (comparable) {
            const value = buildValue(context, recipe, position, choice);
            if (kept.some((earlier) => Object.is(earlier, value))) {
                return;
            }
            kept.push(value);
        }
        choices.push(choice);
    };
    const boundary = boundaryCount(context, recipe);
    for (let index = 0; index < boundary; index += 1) {
        add({
            source: "boundary",
            index,
        });
    }
    if (isSeedVarying(context, recipe)) {
        for (let index = 0; index < seededCount; index += 1) {
            add({
                source: "seeded",
                index,
            });
        }
    }
    const conditions = conditionCount(context, recipe);
    for (let index = 0; index < conditions; index += 1) {
        add({
            source: "condition",
            index,
        });
    }
    return choices;
}

// Lists the choices for every parameter of a function, in parameter order.
export function listParameterChoices(context: IValueContext, parameters: readonly ParameterInfo[]): IChoice[][] {
    return parameters.map((parameter, position) => listChoices(context, parameterRecipe(parameter), position));
}

//
// Every call a function is made with: the baseline and each parameter's other choices one at a
// time. It is empty when a parameter has no value to give.
//
export function listCallSpecs(context: IValueContext, parameters: readonly ParameterInfo[]): Spec[] {
    return generateSpecs(listParameterChoices(context, parameters));
}

// The arguments of one call, built from a specification with one choice per parameter. A rest
// parameter's value is a list, and its elements are passed as the arguments it takes.
export function buildArguments(context: IValueContext, parameters: readonly ParameterInfo[], spec: Spec): unknown[] {
    assert.equal(spec.length, parameters.length, "A call names one choice per parameter.");
    const built: unknown[] = [];
    parameters.forEach((parameter, position) => {
        const value = buildValue(context, parameterRecipe(parameter), position, spec[position]!);
        if (parameter.rest) {
            assert.ok(Array.isArray(value), `The rest parameter ${parameter.name} was built as no list.`);
            built.push(...value);
            return;
        }
        built.push(value);
    });
    return built;
}

// The sum of a list of counts.
export function sum(counts: readonly number[]): number {
    let total = 0;
    for (const count of counts) {
        total += count;
    }
    return total;
}
