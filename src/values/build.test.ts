//
// Checks how each parameter's choices are listed and how the value for each choice is built.
//
// The goal is to show the boundary values per type, the seeded values for a seed, the values read
// from conditions per kind, factory selection (a named type with factories takes only its
// factories, a factory class gives the next value of its sequence) and the calls made from the
// parameters' choices. The method is to write recipes out as discovery gives them, list the
// choices for a recipe, build the value of each and compare what was built with what the user
// guide says each type is tried with.
//

import assert from "node:assert/strict";
import { afterEach, describe, test } from "@jest/globals";
import type { Condition, ConditionLiteral } from "../discover/conditions.ts";
import type { ParameterInfo } from "../discover/functions.ts";
import type { Property, Recipe } from "../discover/recipes.ts";
import type { FactoryInfo } from "../discover/sim.ts";
import { clockStartMs } from "../world/clock.ts";
import { runWith } from "../world/current.ts";
import { SeededRng } from "../world/random.ts";
import { RunSubject } from "../world/subject.ts";
import { boundaryNumbers, seededCount } from "./boundary.ts";
import {
    allowsUndefined,
    boundaryCount,
    buildArguments,
    buildBaseline,
    buildBoundary,
    buildCondition,
    buildObject,
    buildPart,
    buildSeeded,
    buildSeededObject,
    buildValue,
    buildableOptions,
    conditionCount,
    contextMaking,
    countBoundary,
    countCondition,
    createValueContext,
    factoryCount,
    factoryKey,
    isComparable,
    leafFactoryCount,
    isSeedVarying,
    listCallSpecs,
    listChoices,
    listParameterChoices,
    makeWithFactory,
    mapPartCount,
    objectConditionCount,
    objectCount,
    objectIsSeedVarying,
    parameterRecipe,
    partsCount,
    seededElements,
    sum,
    unionSide,
    type IValueContext,
} from "./build.ts";
import { writeChoice, type IChoice } from "./choices.ts";
import { createFactoryTable, type SimExports } from "./factories.ts";

afterEach(() => {
    runWith(undefined);
});

//
// The recipe of a string.
//
const text: Recipe = {
    kind: "string",
};

//
// The recipe of a number.
//
const number: Recipe = {
    kind: "number",
};

//
// The recipe of a bigint.
//
const bigint: Recipe = {
    kind: "bigint",
};

//
// The recipe of a boolean.
//
const boolean: Recipe = {
    kind: "boolean",
};

//
// The recipe of a type no value can be built for.
//
const unbuildable: Recipe = {
    kind: "unknown",
    text: "Widget",
};

//
// A literal recipe holding `value`.
//
export function literal(value: string | number | boolean): Recipe {
    return {
        kind: "literal",
        value,
    };
}

//
// A union of the recipes given.
//
export function union(options: Recipe[]): Recipe {
    return {
        kind: "union",
        options,
    };
}

//
// A property called `name`, required unless `optional`.
//
export function property(name: string, recipe: Recipe, optional: boolean): Property {
    return {
        name,
        recipe,
        optional,
    };
}

//
// An object recipe with the properties given.
//
export function object(properties: Property[]): Recipe {
    return {
        kind: "object",
        properties,
    };
}

//
// A parameter called `name` built from `recipe`.
//
export function parameter(name: string, recipe: Recipe, optional: boolean, rest: boolean): ParameterInfo {
    return {
        name,
        typeName: name,
        recipe,
        optional,
        rest,
    };
}

//
// A condition of `kind` testing against `literalValue`.
//
export function conditionOf(kind: Condition["kind"], literalValue: ConditionLiteral): Condition {
    return {
        line: 1,
        kind,
        literal: literalValue,
        subject: "x",
    };
}

//
// A context with no conditions and no factories, seeded with one.
//
export function plainContext(): IValueContext {
    return createValueContext(1, [], createFactoryTable([], new Map()));
}

//
// A context whose function tests against `conditions`.
//
export function conditionContext(conditions: Condition[]): IValueContext {
    return createValueContext(1, conditions, createFactoryTable([], new Map()));
}

//
// A context seeded with `seed` whose sim file `a.sim.ts` exports `exports`, offering `factories`.
//
export function factoryContext(seed: number, factories: FactoryInfo[], exports: SimExports): IValueContext {
    return createValueContext(seed, [], createFactoryTable(factories, new Map([["a.sim.ts", exports]])));
}

//
// A factory for the type `Loader` declared in `a.ts`, exported from `a.sim.ts` as `exportName`.
//
export function loaderFactory(exportName: string, parameters: ParameterInfo[]): FactoryInfo {
    return {
        key: "a.ts#Loader",
        typeName: "Loader",
        file: "a.sim.ts",
        exportName,
        parameters,
    };
}

//
// The named recipe for `Loader`, whose own properties are one string called `path`.
//
const loader: Recipe = {
    kind: "named",
    key: "a.ts#Loader",
    name: "Loader",
    structural: object([property("path", text, false)]),
};

//
// The choices for a recipe at parameter position zero, written as a replay token writes them.
//
export function choicesOf(context: IValueContext, recipe: Recipe): string[] {
    return listChoices(context, recipe, 0).map((choice) => writeChoice(choice));
}

//
// Every value the choices of a recipe build, at parameter position zero.
//
export function valuesOf(context: IValueContext, recipe: Recipe): unknown[] {
    return listChoices(context, recipe, 0).map((choice) => buildValue(context, recipe, 0, choice));
}

//
// Every boundary value of a recipe.
//
export function boundaryValuesOf(context: IValueContext, recipe: Recipe): unknown[] {
    const values: unknown[] = [];
    for (let index = 0; index < boundaryCount(context, recipe); index += 1) {
        values.push(buildBoundary(context, recipe, index));
    }
    return values;
}

//
// Every value the conditions give a recipe.
//
export function conditionValuesOf(context: IValueContext, recipe: Recipe): unknown[] {
    const values: unknown[] = [];
    for (let index = 0; index < conditionCount(context, recipe); index += 1) {
        values.push(buildCondition(context, recipe, index));
    }
    return values;
}

//
// The choice from `source` at `index`.
//
export function choiceOf(source: IChoice["source"], index: number): IChoice {
    return {
        source,
        index,
    };
}

//
// Whether a built value is a function the test can call with no argument, so a value built for a
// function type is called without a cast.
//
export function isCallable(value: unknown): value is () => unknown {
    return typeof value === "function";
}

//
// Whether a built value is a list, so the elements of a list built for an array type are read
// without a cast.
//
export function isList(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

//
// Whether a built value is an object whose properties the test can read by name.
//
export function isObject(value: unknown): value is object {
    if (typeof value !== "object") {
        return false;
    }
    return value !== null;
}

//
// What a function built for a function type hands back when it is called, or the text "not a
// function" when the value built is not one.
//
export function returnedBy(passed: unknown): unknown {
    if (!isCallable(passed)) {
        return "not a function";
    }
    return passed();
}

//
// A factory class whose method hands back the next loader of its sequence.
//
export class Loaders {
    //
    // How many loaders this instance has handed out.
    //
    private at = 0;

    //
    // The next loader of the sequence.
    //
    next(): string {
        this.at += 1;
        return `loader ${this.at}`;
    }
}

describe("buildBoundary", () => {
    test("a string is tried empty and one character long, then with seeded strings", () => {
        const context = plainContext();
        assert.deepEqual(boundaryValuesOf(context, text), ["", "a"]);
        const choices = choicesOf(context, text);
        assert.deepEqual(choices.slice(0, 2), ["b0", "b1"]);
        assert.ok(choices.slice(2).every((choice) => choice.startsWith("s")));
    });

    test("a number is tried with every boundary value the user guide lists, in its order", () => {
        const context = plainContext();
        const values = boundaryValuesOf(context, number);
        assert.equal(values.length, boundaryNumbers.length);
        values.forEach((value, index) => {
            assert.ok(Object.is(value, boundaryNumbers[index]), `${String(value)} at ${index}`);
        });
        assert.deepEqual(choicesOf(context, number).slice(0, boundaryNumbers.length), boundaryNumbers.map((_value, index) => `b${index}`));
    });

    test("a bigint is tried with zero, one and minus one", () => {
        assert.deepEqual(boundaryValuesOf(plainContext(), bigint), [0n, 1n, -1n]);
    });

    test("a value of any type is tried as every kind of value JavaScript has", () => {
        const context = plainContext();
        const kinds = new Set(boundaryValuesOf(context, {
            kind: "any",
        }).map((value) => (Array.isArray(value) ? "array" : value === null ? "null" : typeof value)));
        assert.deepEqual([...kinds].sort(), ["array", "boolean", "null", "number", "object", "string", "undefined"]);
    });

    test("a list is tried empty, then with one element of each of the element's boundary values", () => {
        const context = plainContext();
        assert.deepEqual(boundaryValuesOf(context, {
            kind: "array",
            element: text,
        }), [[], [""], ["a"]]);
        assert.deepEqual(boundaryValuesOf(context, {
            kind: "set",
            element: text,
        }), [new Set(), new Set([""]), new Set(["a"])]);
    });

    test("a map is tried empty, then with one entry whose key and value step through their lists together", () => {
        const context = plainContext();
        const maps = boundaryValuesOf(context, {
            kind: "map",
            key: text,
            value: boolean,
        });
        assert.deepEqual(maps, [new Map(), new Map([["", false]]), new Map([["a", true]])]);
    });

    test("a tuple steps its elements through their lists together, as many values as its longest list", () => {
        const context = plainContext();
        const tuples = boundaryValuesOf(context, {
            kind: "tuple",
            elements: [text, bigint],
        });
        assert.deepEqual(tuples, [["", 0n], ["a", 1n], ["", -1n]]);
        assert.deepEqual(boundaryValuesOf(context, {
            kind: "tuple",
            elements: [],
        }), [[]]);
    });

    test("an object steps its properties together and leaves an optional one out first", () => {
        const context = plainContext();
        const objects = boundaryValuesOf(context, object([property("count", bigint, false), property("name", text, true)]));
        assert.deepEqual(objects, [
            {
                count: 0n,
            },
            {
                count: 1n,
                name: "",
            },
            {
                count: -1n,
                name: "a",
            },
        ]);
    });

    test("a record is tried with no entry, then with one entry of each of its value's boundary values", () => {
        const context = plainContext();
        const record: Recipe = {
            kind: "object",
            properties: [],
            index: boolean,
        };
        assert.deepEqual(boundaryValuesOf(context, record), [
            {},
            {
                a: false,
            },
            {
                a: true,
            },
        ]);
    });

    test("a record whose declared properties already use the entry's key gets no entry", () => {
        const context = plainContext();
        const record: Recipe = {
            kind: "object",
            properties: [property("a", literal(1), false)],
            index: boolean,
        };
        assert.deepEqual(boundaryValuesOf(context, record), [
            {
                a: 1,
            },
            {
                a: 1,
            },
            {
                a: 1,
            },
        ]);
    });

    test("dates, addresses, bytes, errors and patterns are each built as their runtime type", () => {
        const context = plainContext();
        const dates = boundaryValuesOf(context, {
            kind: "date",
        });
        assert.deepEqual(dates.map((date) => (date instanceof Date ? date.getTime() : "not a date")), [0, clockStartMs, Number.NaN]);
        const urls = boundaryValuesOf(context, {
            kind: "url",
        });
        assert.ok(urls.every((url) => url instanceof URL));
        const bytes = boundaryValuesOf(context, {
            kind: "bytes",
            name: "Buffer",
        });
        assert.deepEqual(bytes.map((value) => (Buffer.isBuffer(value) ? value.length : -1)), [0, 1]);
        const errors = boundaryValuesOf(context, {
            kind: "error",
            name: "TypeError",
        });
        assert.ok(errors.every((error) => error instanceof TypeError));
        const patterns = valuesOf(context, {
            kind: "regexp",
        });
        assert.equal(patterns.length, 1);
        assert.ok(patterns[0] instanceof RegExp);
    });

    test("a signal is tried live and already aborted", () => {
        const context = plainContext();
        const signals = boundaryValuesOf(context, {
            kind: "effect",
            effect: "signal",
        });
        assert.deepEqual(signals.map((signal) => (signal instanceof AbortSignal ? signal.aborted : "not a signal")), [false, true]);
    });

    test("a promise resolves to each value of what it holds", async () => {
        const context = plainContext();
        const promises = boundaryValuesOf(context, {
            kind: "promise",
            value: text,
        });
        assert.deepEqual(await Promise.all(promises), ["", "a"]);
    });

    test("a function passed in returns each value of its return type and is a place a failure can be injected", async () => {
        const context = plainContext();
        const functions = boundaryValuesOf(context, {
            kind: "function",
            returns: text,
        });
        assert.deepEqual(functions.map((passed) => returnedBy(passed)), ["", "a"]);
        const subject = new RunSubject(1, {
            place: {
                effect: "function-passed-in",
                occurrence: 0,
            },
            failure: "rejects",
        });
        runWith(subject);
        const asynchronous = buildBoundary(context, {
            kind: "function",
            returns: {
                kind: "promise",
                value: text,
            },
        }, 0);
        assert.ok(isCallable(asynchronous));
        await assert.rejects(Promise.resolve(asynchronous()), /rejected/);
        const reached = subject.injector.reached[0];
        assert.ok(reached);
        assert.deepEqual(reached.failures, ["throws", "rejects"]);
    });

    test("a named type inside another value is built by its factories too", () => {
        const context = factoryContext(1, [loaderFactory("first", []), loaderFactory("second", [])], {
            first: (): string => "first",
            second: (): string => "second",
        });
        const holder = object([property("loader", loader, false), property("name", text, false)]);
        assert.deepEqual(boundaryValuesOf(context, holder), [
            {
                loader: "first",
                name: "",
            },
            {
                loader: "second",
                name: "a",
            },
        ]);
        const seeded = buildSeeded(context, holder, new SeededRng(5), 0);
        assert.ok(isObject(seeded));
        assert.ok(["first", "second"].includes(String(Reflect.get(seeded, "loader"))));
        assert.equal(conditionCount(context, loader), 0);
    });
});

describe("listChoices", () => {
    test("a boolean is tried false then true, and its seeded values repeat those so they are dropped", () => {
        const context = plainContext();
        assert.deepEqual(valuesOf(context, boolean), [false, true]);
        assert.deepEqual(choicesOf(context, boolean), ["b0", "b1"]);
    });

    test("null, undefined, void and a literal each have the one value they allow and no seeded value", () => {
        const context = plainContext();
        assert.deepEqual(valuesOf(context, {
            kind: "null",
        }), [null]);
        assert.deepEqual(valuesOf(context, {
            kind: "undefined",
        }), [undefined]);
        assert.deepEqual(valuesOf(context, {
            kind: "void",
        }), [undefined]);
        assert.deepEqual(valuesOf(context, literal("x")), ["x"]);
    });

    test("a union is tried with every value of every side, and null and undefined only where it allows them", () => {
        const context = plainContext();
        assert.deepEqual(valuesOf(context, union([literal("x"), literal("y")])), ["x", "y"]);
        const optional = valuesOf(context, union([{
            kind: "undefined",
        }, text]));
        assert.deepEqual(optional.slice(0, 3), [undefined, "", "a"]);
        assert.ok(!optional.includes(null));
    });

    test("a type that cannot be built has no choice, and neither has a union of such types", () => {
        const context = plainContext();
        assert.deepEqual(choicesOf(context, unbuildable), []);
        assert.deepEqual(choicesOf(context, {
            kind: "never",
        }), []);
        assert.deepEqual(choicesOf(context, {
            kind: "effect",
            effect: "scenario",
        }), []);
        assert.deepEqual(choicesOf(context, union([unbuildable])), []);
        assert.deepEqual(choicesOf(context, object([property("widget", unbuildable, false)])), []);
        assert.deepEqual(choicesOf(context, {
            kind: "tuple",
            elements: [text, unbuildable],
        }), []);
        assert.throws(() => buildBoundary(context, unbuildable, 0), /No value can be built for a unknown/);
        assert.throws(() => buildSeeded(context, unbuildable, new SeededRng(1), 0), /No value can be built for a unknown/);
    });

    test("a list, a set or a map of a type that cannot be built is only ever empty", () => {
        const context = plainContext();
        assert.deepEqual(valuesOf(context, {
            kind: "array",
            element: unbuildable,
        }), [[]]);
        assert.deepEqual(valuesOf(context, {
            kind: "set",
            element: unbuildable,
        }), [new Set()]);
        assert.deepEqual(valuesOf(context, {
            kind: "map",
            key: text,
            value: unbuildable,
        }), [new Map()]);
    });

    test("an optional property of a type that cannot be built is always left out", () => {
        const context = plainContext();
        assert.deepEqual(valuesOf(context, object([property("widget", unbuildable, true)])), [{}]);
    });

    test("a named type with no factory is built from its own properties", () => {
        const context = plainContext();
        assert.deepEqual(valuesOf(context, loader).slice(0, 2), [
            {
                path: "",
            },
            {
                path: "a",
            },
        ]);
    });

    test("a named type with factories takes only its factories, the first written being the baseline", () => {
        const context = factoryContext(1, [loaderFactory("working", []), loaderFactory("broken", [])], {
            working: (): string => "working loader",
            broken: (): string => "broken loader",
        });
        assert.deepEqual(choicesOf(context, loader), ["f0", "f1"]);
        assert.deepEqual(valuesOf(context, loader), ["working loader", "broken loader"]);
    });

    test("numbers read from conditions follow the boundary and seeded values, dropping those already tried", () => {
        const context = conditionContext([conditionOf("comparison", {
            kind: "number",
            value: 100,
        }), conditionOf("comparison", {
            kind: "number",
            value: 0,
        })]);
        const choices = listChoices(context, number, 0);
        const fromConditions = choices.filter((choice) => choice.source === "condition");
        //
        // 100, 99 and 101; then 0, -1 and 1, which are boundary values already.
        //
        assert.deepEqual(fromConditions.map((choice) => buildValue(context, number, 0, choice)), [100, 99, 101]);
        assert.deepEqual(choices.map((choice) => choice.source), [
            ...boundaryNumbers.map(() => "boundary"),
            ...Array.from({
                length: seededCount,
            }, () => "seeded"),
            "condition",
            "condition",
            "condition",
        ]);
    });
});

describe("mapPartCount", () => {
    test("a map with no entry to build has no part, and one with entries has as many as its longer side", () => {
        assert.equal(mapPartCount(0, 3), 0);
        assert.equal(mapPartCount(2, 3), 3);
    });
});

describe("partsCount", () => {
    test("no part counts as one value and a part with no value leaves none", () => {
        assert.equal(partsCount([]), 1);
        assert.equal(partsCount([2, 0]), 0);
    });
});

describe("buildValue", () => {
    test("a factory class's method gives each of the first values of its sequence as a choice of its own, the same each time it is built", () => {
        const factory: FactoryInfo = {
            ...loaderFactory("Loaders", []),
            method: "next",
            ownerParameters: [],
        };
        const context = factoryContext(1, [factory], {
            Loaders,
        });
        assert.equal(buildValue(context, loader, 0, choiceOf("factory", 0)), "loader 1");
        assert.equal(buildValue(context, loader, 0, choiceOf("factory", 1)), "loader 2");
        assert.equal(buildValue(context, loader, 0, choiceOf("factory", 2)), "loader 3");
        assert.equal(buildValue(context, loader, 0, choiceOf("factory", 1)), "loader 2");
    });

    test("a factory's own parameters are given their baseline values", () => {
        const context = factoryContext(1, [loaderFactory("named", [parameter("count", bigint, false, false), parameter("widget", unbuildable, false, false)])], {
            named: (count: bigint, widget: unknown): string => `${count} ${String(widget)}`,
        });
        assert.equal(buildValue(context, loader, 0, choiceOf("factory", 0)), "0 undefined");
    });

    test("a factory that takes a value of the type it returns is given one built from the type's properties", () => {
        const context = factoryContext(1, [loaderFactory("wrapping", [parameter("inner", loader, false, false)])], {
            wrapping: (inner: unknown): unknown => ({
                wrapped: inner,
            }),
        });
        assert.deepEqual(buildValue(context, loader, 0, choiceOf("factory", 0)), {
            wrapped: {
                path: "",
            },
        });
    });

    test("the same seed builds the same seeded values and another seed builds others", () => {
        const recipe = object([property("name", text, false), property("count", number, false), property("tags", {
            kind: "array",
            element: text,
        }, false)]);
        const first = listChoices(createValueContext(7, [], createFactoryTable([], new Map())), recipe, 0);
        const seeded = first.filter((choice) => choice.source === "seeded");
        assert.equal(seeded.length, seededCount);
        const once = seeded.map((choice) => buildValue(createValueContext(7, [], createFactoryTable([], new Map())), recipe, 0, choice));
        const again = seeded.map((choice) => buildValue(createValueContext(7, [], createFactoryTable([], new Map())), recipe, 0, choice));
        assert.deepEqual(once, again);
        const other = seeded.map((choice) => buildValue(createValueContext(8, [], createFactoryTable([], new Map())), recipe, 0, choice));
        assert.notDeepEqual(once, other);
        const atAnotherPosition = seeded.map((choice) => buildValue(createValueContext(7, [], createFactoryTable([], new Map())), recipe, 1, choice));
        assert.notDeepEqual(once, atAnotherPosition);
    });

    test("a choice the recipe does not have is a programmer error", () => {
        const context = plainContext();
        assert.throws(() => buildValue(context, text, 0, choiceOf("boundary", 2)), /no boundary value 2/);
        assert.throws(() => buildValue(context, text, 0, choiceOf("seeded", seededCount)), /no seeded value/);
        assert.throws(() => buildValue(context, text, 0, choiceOf("condition", 0)), /give no value 0/);
        assert.throws(() => buildValue(context, { kind: "null" }, 0, choiceOf("factory", 0)), /Only a named type or a built-in value type has value factories/);
        assert.throws(() => buildValue(context, text, 0, choiceOf("factory", 0)), /no value factory 0 for builtin#string/);
        assert.throws(() => buildValue(context, loader, 0, choiceOf("factory", 0)), /no value factory 0 for a\.ts#Loader/);
    });
});

//
// A factory for `Date`, exported from `a.sim.ts` as `exportName`.
//
export function dateFactory(exportName: string): FactoryInfo {
    return {
        key: "builtin#Date",
        typeName: "Date",
        file: "a.sim.ts",
        exportName,
        parameters: [],
    };
}

describe("value factories for a built-in value type", () => {
    //
    // The recipe of a date.
    //
    const date: Recipe = {
        kind: "date",
    };

    //
    // A context whose sim file offers two dates, the second far ahead of the first.
    //
    function twoDates(): IValueContext {
        return factoryContext(1, [dateFactory("early"), dateFactory("late")], {
            early: () => new Date("2000-01-01T00:00:00.000Z"),
            late: () => new Date("2099-01-01T00:00:00.000Z"),
        });
    }

    test("a date parameter with factories takes only their dates, in the order they are written", () => {
        const context = twoDates();
        const choices = listChoices(context, date, 0);
        assert.deepEqual(choices, [choiceOf("factory", 0), choiceOf("factory", 1)]);
        assert.deepEqual(choices.map((choice) => buildValue(context, date, 0, choice)), [new Date("2000-01-01T00:00:00.000Z"), new Date("2099-01-01T00:00:00.000Z")]);
    });

    test("a date inside an object is one of the factories' dates, as a boundary and as a seeded value", () => {
        const context = twoDates();
        const pause = object([property("pausedAt", date, false)]);
        assert.equal(boundaryCount(context, pause), 2);
        assert.deepEqual(buildBoundary(context, pause, 1), {
            pausedAt: new Date("2099-01-01T00:00:00.000Z"),
        });
        const seeded = buildSeeded(context, date, new SeededRng(3), 0);
        assert.ok(seeded instanceof Date);
        assert.ok([946684800000, 4070908800000].includes(seeded.getTime()));
    });

    test("a type with factories reads no values from conditions and varies with the seed only when it has more than one", () => {
        const context = twoDates();
        assert.equal(countCondition(context, date), 0);
        assert.equal(isSeedVarying(context, date), true);
        const one = factoryContext(1, [dateFactory("early")], {
            early: () => new Date("2000-01-01T00:00:00.000Z"),
        });
        assert.equal(isSeedVarying(one, date), false);
        assert.equal(leafFactoryCount(one, date), 1);
    });

    test("a built-in value type with no factory keeps its own values", () => {
        const context = plainContext();
        assert.equal(leafFactoryCount(context, date), 0);
        assert.equal(listChoices(context, date, 0)[0]?.source, "boundary");
        assert.equal(leafFactoryCount(context, { kind: "null" }), 0);
    });

    test("the key factories are found by is the named type's own or the built-in value type's", () => {
        assert.equal(factoryKey(loader), "a.ts#Loader");
        assert.equal(factoryKey(date), "builtin#Date");
        assert.equal(factoryKey({ kind: "null" }), undefined);
    });
});

describe("contextMaking", () => {
    test("a context cannot be making one factory twice", () => {
        const context = contextMaking(plainContext(), "a.ts#Loader");
        assert.deepEqual(context.making, ["a.ts#Loader"]);
        assert.throws(() => contextMaking(context, "a.ts#Loader"));
    });
});

describe("buildSeeded", () => {
    test("a seeded value of every kind is a value of that kind", async () => {
        const context = factoryContext(1, [loaderFactory("only", [])], {
            only: (): string => "only",
        });
        const everything = object([
            property("any", {
                kind: "any",
            }, false),
            property("text", text, false),
            property("bigint", bigint, false),
            property("flag", boolean, false),
            property("nothing", {
                kind: "null",
            }, false),
            property("absent", {
                kind: "undefined",
            }, false),
            property("literal", literal(3), false),
            property("pattern", {
                kind: "regexp",
            }, false),
            property("signal", {
                kind: "effect",
                effect: "signal",
            }, false),
            property("choice", union([literal("x"), unbuildable]), false),
            property("set", {
                kind: "set",
                element: number,
            }, false),
            property("map", {
                kind: "map",
                key: text,
                value: number,
            }, false),
            property("emptyMap", {
                kind: "map",
                key: unbuildable,
                value: number,
            }, false),
            property("emptyList", {
                kind: "array",
                element: unbuildable,
            }, false),
            property("tuple", {
                kind: "tuple",
                elements: [text, number],
            }, false),
            property("date", {
                kind: "date",
            }, false),
            property("url", {
                kind: "url",
            }, false),
            property("bytes", {
                kind: "bytes",
                name: "Uint8Array",
            }, false),
            property("error", {
                kind: "error",
                name: "RangeError",
            }, false),
            property("promise", {
                kind: "promise",
                value: text,
            }, false),
            property("callback", {
                kind: "function",
                returns: number,
            }, false),
            property("asyncCallback", {
                kind: "function",
                returns: {
                    kind: "promise",
                    value: number,
                },
            }, false),
            property("loader", loader, false),
            property("structural", {
                kind: "named",
                key: "a.ts#Other",
                name: "Other",
                structural: object([]),
            }, false),
            property("widget", unbuildable, true),
        ]);
        for (let seed = 0; seed < 20; seed += 1) {
            const built = buildSeeded(context, everything, new SeededRng(seed), 0);
            assert.ok(isObject(built));
            assert.equal(typeof Reflect.get(built, "text"), "string");
            assert.equal(typeof Reflect.get(built, "bigint"), "bigint");
            assert.equal(typeof Reflect.get(built, "flag"), "boolean");
            assert.equal(Reflect.get(built, "nothing"), null);
            assert.equal(Reflect.get(built, "absent"), undefined);
            assert.equal(Reflect.get(built, "literal"), 3);
            assert.ok(Reflect.get(built, "pattern") instanceof RegExp);
            assert.ok(Reflect.get(built, "signal") instanceof AbortSignal);
            assert.equal(Reflect.get(built, "choice"), "x");
            assert.ok(Reflect.get(built, "set") instanceof Set);
            assert.ok(Reflect.get(built, "map") instanceof Map);
            const emptyMap: unknown = Reflect.get(built, "emptyMap");
            assert.ok(emptyMap instanceof Map);
            assert.equal(emptyMap.size, 0);
            assert.deepEqual(Reflect.get(built, "emptyList"), []);
            const tuple: unknown = Reflect.get(built, "tuple");
            assert.ok(isList(tuple));
            assert.equal(tuple.length, 2);
            assert.ok(Reflect.get(built, "date") instanceof Date);
            assert.ok(Reflect.get(built, "url") instanceof URL);
            assert.ok(Reflect.get(built, "bytes") instanceof Uint8Array);
            assert.ok(Reflect.get(built, "error") instanceof RangeError);
            assert.equal(typeof (await Reflect.get(built, "promise")), "string");
            assert.equal(typeof returnedBy(Reflect.get(built, "callback")), "number");
            assert.equal(typeof (await returnedBy(Reflect.get(built, "asyncCallback"))), "number");
            assert.equal(Reflect.get(built, "loader"), "only");
            assert.deepEqual(Reflect.get(built, "structural"), {});
            assert.ok(!("widget" in built));
        }
    });

    test("seeded signals come both live and aborted, and seeded optional properties both given and left out", () => {
        const context = plainContext();
        const aborted = new Set<boolean>();
        const given = new Set<boolean>();
        for (let seed = 0; seed < 40; seed += 1) {
            const rng = new SeededRng(seed);
            const signal = buildSeeded(context, {
                kind: "effect",
                effect: "signal",
            }, rng, 0);
            assert.ok(signal instanceof AbortSignal);
            aborted.add(signal.aborted);
            const built = buildSeeded(context, object([property("name", text, true)]), rng, 0);
            assert.ok(isObject(built));
            given.add("name" in built);
        }
        assert.deepEqual([...aborted].sort(), [false, true]);
        assert.deepEqual([...given].sort(), [false, true]);
    });

    test("a seeded list inside lists is shorter at every level", () => {
        const context = plainContext();
        const nested: Recipe = {
            kind: "array",
            element: {
                kind: "array",
                element: {
                    kind: "array",
                    element: {
                        kind: "array",
                        element: number,
                    },
                },
            },
        };
        for (let seed = 0; seed < 20; seed += 1) {
            const outer = buildSeeded(context, nested, new SeededRng(seed), 0);
            assert.ok(isList(outer));
            assert.ok(outer.length <= 8);
            for (const second of outer) {
                assert.ok(isList(second));
                assert.ok(second.length <= 4);
                for (const third of second) {
                    assert.ok(isList(third));
                    assert.ok(third.length <= 2);
                    for (const fourth of third) {
                        assert.ok(isList(fourth));
                        assert.ok(fourth.length <= 1);
                    }
                }
            }
        }
    });

    test("a seeded record gets entries under seeded keys and never overwrites a declared property", () => {
        const context = plainContext();
        const record: Recipe = {
            kind: "object",
            properties: [property("", literal("declared"), false)],
            index: number,
        };
        let entries = 0;
        for (let seed = 0; seed < 60; seed += 1) {
            const built = buildSeeded(context, record, new SeededRng(seed), 0);
            assert.ok(isObject(built));
            assert.equal(Reflect.get(built, ""), "declared");
            entries += Object.keys(built).length - 1;
        }
        assert.ok(entries > 0);
        const unbuildableRecord: Recipe = {
            kind: "object",
            properties: [],
            index: unbuildable,
        };
        assert.deepEqual(buildSeeded(context, unbuildableRecord, new SeededRng(1), 0), {});
    });
});

describe("isSeedVarying", () => {
    test("a recipe with one value whatever the seed is offered no seeded value", () => {
        const context = factoryContext(1, [loaderFactory("only", [])], {
            only: (): string => "only",
        });
        assert.equal(isSeedVarying(context, unbuildable), false);
        assert.equal(isSeedVarying(context, {
            kind: "regexp",
        }), false);
        assert.equal(isSeedVarying(context, union([literal("x")])), false);
        assert.equal(isSeedVarying(context, union([literal("x"), literal("y")])), true);
        assert.equal(isSeedVarying(context, union([text])), true);
        assert.equal(isSeedVarying(context, {
            kind: "tuple",
            elements: [literal(1)],
        }), false);
        assert.equal(isSeedVarying(context, {
            kind: "tuple",
            elements: [number],
        }), true);
        assert.equal(isSeedVarying(context, object([property("fixed", literal(1), false)])), false);
        assert.equal(isSeedVarying(context, object([property("varies", number, false)])), true);
        assert.equal(isSeedVarying(context, object([property("left out", literal(1), true)])), true);
        assert.equal(isSeedVarying(context, object([property("never given", unbuildable, true)])), false);
        assert.equal(isSeedVarying(context, {
            kind: "object",
            properties: [],
            index: literal(1),
        }), true);
        assert.equal(isSeedVarying(context, {
            kind: "object",
            properties: [],
            index: unbuildable,
        }), false);
        assert.equal(isSeedVarying(context, {
            kind: "array",
            element: unbuildable,
        }), false);
        assert.equal(isSeedVarying(context, {
            kind: "map",
            key: text,
            value: unbuildable,
        }), false);
        assert.equal(isSeedVarying(context, {
            kind: "map",
            key: literal(1),
            value: literal(2),
        }), true);
        assert.equal(isSeedVarying(context, {
            kind: "promise",
            value: literal(1),
        }), false);
        assert.equal(isSeedVarying(context, {
            kind: "function",
            returns: number,
        }), true);
        assert.equal(isSeedVarying(context, loader), false);
        assert.equal(isSeedVarying(plainContext(), loader), true);
        assert.equal(isSeedVarying(context, {
            kind: "date",
        }), true);
    });

    test("a named type with more than one factory is seed varying", () => {
        const context = factoryContext(1, [loaderFactory("first", []), loaderFactory("second", [])], {
            first: (): string => "first",
            second: (): string => "second",
        });
        assert.equal(isSeedVarying(context, loader), true);
    });
});

describe("isComparable", () => {
    test("only primitives and unions of them are compared to drop repeated values", () => {
        assert.equal(isComparable(union([text, literal(1), {
            kind: "null",
        }])), true);
        assert.equal(isComparable(union([text, object([])])), false);
        assert.equal(isComparable(object([])), false);
    });
});

describe("buildCondition", () => {
    test("strings, bigints and booleans read from conditions are given to parameters of their type", () => {
        const context = conditionContext([
            conditionOf("starts-with", {
                kind: "string",
                value: "v",
            }),
            conditionOf("comparison", {
                kind: "bigint",
                value: "10",
            }),
            conditionOf("comparison", {
                kind: "boolean",
                value: true,
            }),
        ]);
        assert.deepEqual(conditionValuesOf(context, text), ["v", "w", "va", "wa"]);
        assert.deepEqual(conditionValuesOf(context, bigint), [10n, 9n, 11n]);
        assert.deepEqual(conditionValuesOf(context, boolean), [true]);
        assert.deepEqual(conditionValuesOf(context, {
            kind: "date",
        }), []);
        assert.deepEqual(conditionValuesOf(context, unbuildable), []);
    });

    test("values made of parts take the conditions' values part by part", async () => {
        const context = conditionContext([conditionOf("comparison", {
            kind: "string",
            value: "go",
        })]);
        assert.deepEqual(conditionValuesOf(context, union([{
            kind: "undefined",
        }, text])), ["go", "gn"]);
        assert.deepEqual(conditionValuesOf(context, {
            kind: "any",
        }), ["go", "gn"]);
        assert.deepEqual(conditionValuesOf(context, {
            kind: "array",
            element: text,
        }), [["go"], ["gn"]]);
        assert.deepEqual(conditionValuesOf(context, {
            kind: "set",
            element: text,
        }), [new Set(["go"]), new Set(["gn"])]);
        assert.deepEqual(conditionValuesOf(context, {
            kind: "map",
            key: text,
            value: bigint,
        }), [new Map([["go", 0n]]), new Map([["gn", 0n]])]);
        assert.deepEqual(conditionValuesOf(context, {
            kind: "tuple",
            elements: [bigint, text],
        }), [[0n, "go"], [0n, "gn"]]);
        assert.deepEqual(conditionValuesOf(context, loader), [
            {
                path: "go",
            },
            {
                path: "gn",
            },
        ]);
        assert.deepEqual(await Promise.all(conditionValuesOf(context, {
            kind: "promise",
            value: text,
        })), ["go", "gn"]);
        const functions = conditionValuesOf(context, {
            kind: "function",
            returns: text,
        });
        assert.deepEqual(functions.map((passed) => returnedBy(passed)), ["go", "gn"]);
        const asynchronous = conditionValuesOf(context, {
            kind: "function",
            returns: {
                kind: "promise",
                value: text,
            },
        });
        assert.equal(asynchronous.length, 2);
        assert.equal(await returnedBy(asynchronous[0]), "go");
    });

    test("an object from the conditions leaves an optional part out first and gives a required part with none its baseline", () => {
        const context = conditionContext([conditionOf("comparison", {
            kind: "string",
            value: "go",
        })]);
        const recipe: Recipe = {
            kind: "object",
            properties: [property("count", bigint, false), property("name", text, true), property("flag", boolean, true)],
            index: text,
        };
        assert.deepEqual(conditionValuesOf(context, recipe), [
            {
                count: 0n,
            },
            {
                count: 0n,
                name: "go",
                a: "go",
            },
            {
                count: 0n,
                name: "gn",
                a: "gn",
            },
        ]);
        assert.equal(conditionCount(context, object([property("count", bigint, false)])), 0);
        assert.equal(conditionCount(context, {
            kind: "object",
            properties: [],
            index: bigint,
        }), 0);
    });
});

describe("parameterRecipe", () => {
    test("an optional parameter is also tried left out unless its type already allows undefined", () => {
        const optional = parameterRecipe(parameter("name", text, true, false));
        assert.deepEqual(optional, union([{
            kind: "undefined",
        }, text]));
        const allowing = union([{
            kind: "undefined",
        }, text]);
        assert.equal(parameterRecipe(parameter("name", allowing, true, false)), allowing);
        assert.equal(parameterRecipe(parameter("name", text, false, false)), text);
        const rest: Recipe = {
            kind: "array",
            element: text,
        };
        assert.equal(parameterRecipe(parameter("rest", rest, true, true)), rest);
    });
});

describe("allowsUndefined", () => {
    test("void and any allow undefined and a string does not", () => {
        assert.equal(allowsUndefined({
            kind: "void",
        }), true);
        assert.equal(allowsUndefined({
            kind: "any",
        }), true);
        assert.equal(allowsUndefined(text), false);
    });
});

describe("listCallSpecs", () => {
    test("the baseline and each parameter's other choices one at a time are the calls", () => {
        const context = plainContext();
        const parameters = [parameter("flag", boolean, false, false), parameter("kind", union([literal("x"), literal("y"), literal("z")]), false, false)];
        const lists = listParameterChoices(context, parameters);
        assert.deepEqual(lists.map((list) => list.length), [2, 3]);
        const specs = listCallSpecs(context, parameters);
        const calls = specs.map((spec) => JSON.stringify(buildArguments(context, parameters, spec)));
        assert.deepEqual(calls, [
            JSON.stringify([false, "x"]),
            JSON.stringify([true, "x"]),
            JSON.stringify([false, "y"]),
            JSON.stringify([false, "z"]),
        ]);
    });

    test("a function with a parameter that cannot be built has no call", () => {
        assert.deepEqual(listCallSpecs(plainContext(), [parameter("widget", unbuildable, false, false)]), []);
    });
});

describe("buildArguments", () => {
    test("a rest parameter's list is passed as the arguments it takes", () => {
        const context = plainContext();
        const parameters = [parameter("first", literal(1), false, false), parameter("rest", {
            kind: "array",
            element: text,
        }, false, true)];
        assert.deepEqual(buildArguments(context, parameters, [choiceOf("boundary", 0), choiceOf("boundary", 0)]), [1]);
        assert.deepEqual(buildArguments(context, parameters, [choiceOf("boundary", 0), choiceOf("boundary", 2)]), [1, "a"]);
    });

    test("a call naming the wrong number of choices, or a rest parameter built as no list, is a programmer error", () => {
        const context = plainContext();
        assert.throws(() => buildArguments(context, [parameter("one", text, false, false)], []), /one choice per parameter/);
        assert.throws(() => buildArguments(context, [parameter("rest", text, false, true)], [choiceOf("boundary", 0)]), /built as no list/);
    });
});

describe("unionSide", () => {
    test("an index past every side of a union is a programmer error", () => {
        const context = plainContext();
        assert.throws(() => unionSide(context, [text], 2, (option) => boundaryCount(context, option)), /A union has no value 2/);
    });
});

describe("buildBaseline", () => {
    test("a parameter's baseline is its first choice, and undefined for a type that cannot be built", () => {
        const context = plainContext();
        assert.equal(buildBaseline(context, parameter("name", text, false, false)), "");
        assert.equal(buildBaseline(context, parameter("widget", unbuildable, false, false)), undefined);
    });
});

describe("boundaryCount", () => {
    test("a recipe's counts are worked out once and kept", () => {
        const context = plainContext();
        const recipe = object([property("name", text, false)]);
        assert.equal(boundaryCount(context, recipe), 2);
        assert.equal(context.boundaryCounts.get(recipe), 2);
        assert.equal(boundaryCount(context, recipe), 2);
        assert.equal(conditionCount(context, recipe), 0);
        assert.equal(context.conditionCounts.get(recipe), 0);
        assert.equal(conditionCount(context, recipe), 0);
    });
});

describe("createValueContext", () => {
    test("a seed that is not a whole number is refused", () => {
        assert.throws(() => createValueContext(0.5, [], createFactoryTable([], new Map())));
    });
});

describe("sum", () => {
    test("counts add up", () => {
        assert.equal(sum([]), 0);
        assert.equal(sum([1, 2, 3]), 6);
    });
});

describe("factoryCount", () => {
    test("a factory being made counts as no factory for its own type", () => {
        const context = factoryContext(1, [loaderFactory("only", [])], {
            only: (): string => "only",
        });
        assert.equal(factoryCount(context, "a.ts#Loader"), 1);
        assert.equal(factoryCount(contextMaking(context, "a.ts#Loader"), "a.ts#Loader"), 0);
        assert.equal(factoryCount(context, "a.ts#Other"), 0);
    });
});

describe("countBoundary and countCondition", () => {
    test("counting a recipe afresh gives what the kept count gives", () => {
        const context = plainContext();
        assert.equal(countBoundary(context, text), 2);
        assert.equal(countBoundary(context, union([text, bigint])), 5);
        assert.equal(countCondition(conditionContext([conditionOf("comparison", {
            kind: "number",
            value: 5,
        })]), number), 3);
    });
});

describe("objectCount", () => {
    test("an object counts its largest part, one more for an optional part, and none for a required part that cannot be built", () => {
        const context = plainContext();
        assert.equal(objectCount(context, {
            kind: "object",
            properties: [property("name", text, false)],
        }, (part) => boundaryCount(context, part)), 2);
        assert.equal(objectCount(context, {
            kind: "object",
            properties: [property("name", text, true)],
        }, (part) => boundaryCount(context, part)), 3);
        assert.equal(objectCount(context, {
            kind: "object",
            properties: [property("widget", unbuildable, false)],
        }, (part) => boundaryCount(context, part)), 0);
        assert.equal(objectCount(context, {
            kind: "object",
            properties: [],
        }, (part) => boundaryCount(context, part)), 1);
    });
});

describe("objectConditionCount", () => {
    test("an object's condition count is that of its part given the most, with optional parts also left out", () => {
        const context = conditionContext([conditionOf("comparison", {
            kind: "string",
            value: "go",
        })]);
        assert.equal(objectConditionCount(context, {
            kind: "object",
            properties: [property("name", text, false)],
        }), 2);
        assert.equal(objectConditionCount(context, {
            kind: "object",
            properties: [property("name", text, true)],
        }), 3);
        assert.equal(objectConditionCount(context, {
            kind: "object",
            properties: [],
        }), 0);
    });
});

describe("objectIsSeedVarying", () => {
    test("a seeded object varies with an optional part, an index signature or a varying part", () => {
        const context = plainContext();
        assert.equal(objectIsSeedVarying(context, {
            kind: "object",
            properties: [property("fixed", literal(1), false)],
        }), false);
        assert.equal(objectIsSeedVarying(context, {
            kind: "object",
            properties: [property("name", text, false)],
        }), true);
    });
});

describe("buildableOptions", () => {
    test("only the sides of a union that can be built are offered, in the union's order", () => {
        assert.deepEqual(buildableOptions(plainContext(), [unbuildable, text, unbuildable, bigint]), [text, bigint]);
    });
});

describe("buildObject and buildPart", () => {
    test("an object's parts are built at the object's index, each modulo its own count", () => {
        const context = plainContext();
        assert.deepEqual(buildObject(context, {
            kind: "object",
            properties: [property("count", bigint, false), property("name", text, true)],
        }, 4, (part, partIndex) => buildBoundary(context, part, partIndex), (part) => boundaryCount(context, part)), {
            count: 1n,
            name: "",
        });
        assert.deepEqual(buildPart(context, property("name", text, true), 0, (part, partIndex) => buildBoundary(context, part, partIndex), (part) => boundaryCount(context, part)), {
            given: false,
            value: undefined,
        });
        assert.deepEqual(buildPart(context, property("name", text, true), 2, (part, partIndex) => buildBoundary(context, part, partIndex), (part) => boundaryCount(context, part)), {
            given: true,
            value: "a",
        });
        assert.deepEqual(buildPart(context, property("name", text, false), 3, (part, partIndex) => buildBoundary(context, part, partIndex), (part) => boundaryCount(context, part)), {
            given: true,
            value: "a",
        });
        assert.deepEqual(buildPart(context, property("name", text, false), 0, (part, partIndex) => buildBoundary(context, part, partIndex), () => 0), {
            given: true,
            value: "",
        });
    });
});

describe("seededElements", () => {
    test("seeded elements are as many as the generator says up to the longest, and none of a type that cannot be built", () => {
        const context = plainContext();
        assert.deepEqual(seededElements(context, unbuildable, new SeededRng(1), 0, 8), []);
        const elements = seededElements(context, text, new SeededRng(1), 0, 3);
        assert.ok(elements.length <= 3);
        assert.ok(elements.every((element) => typeof element === "string"));
    });
});

describe("buildSeededObject", () => {
    test("a seeded object gives every required property and only declared or seeded keys", () => {
        const context = plainContext();
        const built = buildSeededObject(context, {
            kind: "object",
            properties: [property("name", text, false)],
        }, new SeededRng(1), 0, 8);
        assert.deepEqual(Object.keys(built), ["name"]);
    });
});

describe("makeWithFactory", () => {
    test("making a value with a factory calls the factory at that index", () => {
        const context = factoryContext(1, [loaderFactory("first", []), loaderFactory("second", [])], {
            first: (): string => "first",
            second: (): string => "second",
        });
        assert.equal(makeWithFactory(context, "a.ts#Loader", 1), "second");
        assert.deepEqual(context.making, []);
    });
});
