//
// Checks the table of value factories.
//
// The goal is to show three things. Factories are found by the key of the type they return in the
// order the sim files declare them. Their parameters are built by the builder given. A factory
// class offers the first values of its sequence as values of their own, each built on a new
// instance with its method called once, twice or three times, so a value depends on its index
// alone. The method is to stand in for the loaded sim files with plain objects holding the
// functions and classes a loaded sim file would export, then read back what the table builds.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import type { ParameterInfo } from "../discover/functions.ts";
import type { FactoryInfo } from "../discover/sim.ts";
import {
    buildInstance,
    countFactoryValues,
    createFactoryTable,
    factoriesByKey,
    factoryValues,
    makeFactoryValue,
    seriesLength,
    type IParameterBuilder,
    type SimExports,
} from "./factories.ts";

//
// A string parameter called `name`.
//
const textParameter: ParameterInfo = {
    name: "name",
    typeName: "string",
    recipe: {
        kind: "string",
    },
    optional: false,
    rest: false,
};

//
// Builds every parameter as the text "built".
//
const builder: IParameterBuilder = {
    build: (): unknown => "built",
};

//
// A factory for the type `Loader` declared in `a.ts`, written in `file` and exported as
// `exportName`.
//
export function factoryOf(file: string, exportName: string, parameters: ParameterInfo[]): FactoryInfo {
    return {
        key: "a.ts#Loader",
        typeName: "Loader",
        file,
        exportName,
        parameters,
    };
}

//
// A factory class that counts how many instances were built and hands back the next number of its
// sequence from `next`.
//
export class Counter {
    //
    // How many instances have been built since a test last set it to zero, so a test sees that
    // every value is built on an instance of its own.
    //
    static built = 0;

    //
    // The number the sequence is at.
    //
    private at: number;

    //
    // Starts the sequence at `start` and counts the instance.
    //
    constructor(start: number) {
        Counter.built += 1;
        this.at = start;
    }

    //
    // Moves the sequence on by one and hands back where it is.
    //
    next(): number {
        this.at += 1;
        return this.at;
    }
}

//
// A factory class whose method hands back the parameter it is given, so a test sees each call's
// parameters built afresh.
//
export class Named {
    //
    // Hands back the name it is given.
    //
    value(name: string): string {
        return name;
    }
}

//
// A factory class whose constructor takes no argument.
//
export class Plain {
    //
    // Hands back the same text every time.
    //
    value(): string {
        return "plain";
    }
}

//
// A class with no method, for a factory that names a method the class lacks.
//
export class Owner {}

describe("createFactoryTable", () => {
    test("factories are counted by the key of the type they return", () => {
        const table = createFactoryTable([factoryOf("a.sim.ts", "first", []), factoryOf("a.sim.ts", "second", [])], new Map());
        assert.equal(table.count("a.ts#Loader"), 2);
        assert.equal(table.count("a.ts#Other"), 0);
    });

    test("the factory at an index is the one the sim files declare at that position", () => {
        const exports: SimExports = {
            first: (): string => "first",
            second: (): string => "second",
        };
        const globals: SimExports = {
            third: (): string => "third",
        };
        const table = createFactoryTable([
            factoryOf("a.sim.ts", "first", []),
            factoryOf("a.sim.ts", "second", []),
            factoryOf("global.sim.ts", "third", []),
        ], new Map([["a.sim.ts", exports], ["global.sim.ts", globals]]));
        assert.equal(table.make("a.ts#Loader", 0, builder), "first");
        assert.equal(table.make("a.ts#Loader", 1, builder), "second");
        assert.equal(table.make("a.ts#Loader", 2, builder), "third");
    });

    test("a factory's parameters are built by the builder given", () => {
        const exports: SimExports = {
            named: (name: string): string => `loader for ${name}`,
        };
        const table = createFactoryTable([factoryOf("a.sim.ts", "named", [textParameter])], new Map([["a.sim.ts", exports]]));
        assert.equal(table.make("a.ts#Loader", 0, builder), "loader for built");
    });

    test("a factory class offers each of the first values of its sequence, each from a new instance built with its constructor's arguments", () => {
        Counter.built = 0;
        const factory: FactoryInfo = {
            ...factoryOf("a.sim.ts", "Counter", []),
            method: "next",
            ownerParameters: [
                {
                    ...textParameter,
                    name: "start",
                },
            ],
        };
        const table = createFactoryTable([factory], new Map([["a.sim.ts", {
            Counter,
        }]]));
        const startAtTen: IParameterBuilder = {
            build: (): unknown => 10,
        };
        assert.equal(table.count("a.ts#Loader"), seriesLength);
        assert.equal(table.make("a.ts#Loader", 0, startAtTen), 11);
        assert.equal(table.make("a.ts#Loader", 1, startAtTen), 12);
        assert.equal(table.make("a.ts#Loader", 2, startAtTen), 13);
        assert.equal(Counter.built, 3);
    });

    test("the same index gives the same value however often it is asked for", () => {
        const factory: FactoryInfo = {
            ...factoryOf("a.sim.ts", "Counter", []),
            method: "next",
            ownerParameters: [textParameter],
        };
        const table = createFactoryTable([factory], new Map([["a.sim.ts", {
            Counter,
        }]]));
        const startAtZero: IParameterBuilder = {
            build: (): unknown => 0,
        };
        assert.equal(table.make("a.ts#Loader", 1, startAtZero), 2);
        assert.equal(table.make("a.ts#Loader", 1, startAtZero), 2);
        assert.equal(table.make("a.ts#Loader", 0, startAtZero), 1);
    });

    test("a method's parameters are built for each call of it", () => {
        let builds = 0;
        const factory: FactoryInfo = {
            ...factoryOf("a.sim.ts", "Named", [textParameter]),
            method: "value",
        };
        const table = createFactoryTable([factory], new Map([["a.sim.ts", {
            Named,
        }]]));
        const counting: IParameterBuilder = {
            build: (): unknown => {
                builds += 1;
                return `name ${builds}`;
            },
        };
        assert.equal(table.make("a.ts#Loader", 2, counting), "name 3");
        assert.equal(builds, 3);
    });

    test("a factory class whose constructor takes no argument is built with none", () => {
        const factory: FactoryInfo = {
            ...factoryOf("a.sim.ts", "Plain", []),
            method: "value",
        };
        const table = createFactoryTable([factory], new Map([["a.sim.ts", {
            Plain,
        }]]));
        assert.equal(table.make("a.ts#Loader", 0, builder), "plain");
        assert.equal(table.make("a.ts#Loader", 2, builder), "plain");
    });

    test("a factory that cannot be found or called is a programmer error and crashes", () => {
        const table = createFactoryTable([
            factoryOf("a.sim.ts", "missing", []),
            factoryOf("b.sim.ts", "unloaded", []),
            {
                ...factoryOf("a.sim.ts", "Owner", []),
                method: "absent",
            },
        ], new Map([["a.sim.ts", {
            Owner,
        }]]));
        assert.throws(() => table.make("a.ts#Other", 0, builder), /No value factory returns the type a.ts#Other/);
        assert.throws(() => table.make("a.ts#Loader", 5, builder), /There is no value factory value 5/);
        assert.throws(() => table.make("a.ts#Loader", 0, builder), /exports no function missing/);
        assert.throws(() => table.make("a.ts#Loader", 1, builder), /The sim file b.sim.ts was not loaded/);
        assert.throws(() => table.make("a.ts#Loader", 2, builder), /Owner has no method absent/);
    });

    test("a factory returning a type with no key is a programmer error and crashes", () => {
        const keyless: FactoryInfo = {
            ...factoryOf("a.sim.ts", "first", []),
            key: "",
        };
        assert.throws(() => createFactoryTable([keyless], new Map()), /returns a type with no key/);
    });
});

describe("factoriesByKey", () => {
    test("factories are grouped by the key of the type they return, each group in the order given", () => {
        const first = factoryOf("a.sim.ts", "first", []);
        const other: FactoryInfo = {
            ...factoryOf("a.sim.ts", "other", []),
            key: "a.ts#Other",
        };
        const second = factoryOf("global.sim.ts", "second", []);
        const byKey = factoriesByKey([first, other, second]);
        assert.deepEqual([...byKey.keys()], ["a.ts#Loader", "a.ts#Other"]);
        assert.deepEqual(byKey.get("a.ts#Loader"), [first, second]);
        assert.deepEqual(byKey.get("a.ts#Other"), [other]);
    });

    test("no factory gives no group", () => {
        assert.equal(factoriesByKey([]).size, 0);
    });
});

describe("countFactoryValues", () => {
    test("a function counts once and a method counts once per place in its series", () => {
        const method: FactoryInfo = {
            ...factoryOf("a.sim.ts", "Counter", []),
            method: "next",
        };
        const byKey = factoriesByKey([factoryOf("a.sim.ts", "first", []), method]);
        assert.equal(countFactoryValues(byKey, "a.ts#Loader"), 1 + seriesLength);
        assert.equal(countFactoryValues(byKey, "a.ts#Other"), 0);
    });

    test("an empty key is a programmer error", () => {
        assert.throws(() => countFactoryValues(new Map(), ""), assert.AssertionError);
    });
});

describe("makeFactoryValue", () => {
    test("the value at an index is built by the factory that offers it", () => {
        const exports: SimExports = {
            first: (): string => "first",
            Counter,
        };
        const method: FactoryInfo = {
            ...factoryOf("a.sim.ts", "Counter", []),
            method: "next",
            ownerParameters: [textParameter],
        };
        const byKey = factoriesByKey([factoryOf("a.sim.ts", "first", []), method]);
        const loaded = new Map([["a.sim.ts", exports]]);
        const startAtZero: IParameterBuilder = {
            build: (): unknown => 0,
        };
        assert.equal(makeFactoryValue(byKey, loaded, "a.ts#Loader", 0, startAtZero), "first");
        assert.equal(makeFactoryValue(byKey, loaded, "a.ts#Loader", 3, startAtZero), 3);
    });

    test("an index past the values offered is a programmer error", () => {
        const byKey = factoriesByKey([factoryOf("a.sim.ts", "first", [])]);
        assert.throws(() => makeFactoryValue(byKey, new Map(), "a.ts#Loader", 1, builder), /There is no value factory value 1/);
    });
});

describe("factoryValues", () => {
    test("every function is one value and every method is one value per place in its series, in the order declared", () => {
        const first = factoryOf("a.sim.ts", "first", []);
        const method: FactoryInfo = {
            ...factoryOf("a.sim.ts", "Counter", []),
            method: "next",
        };
        const values = factoryValues([first, method]);
        assert.deepEqual(values.map((value) => [value.factory.exportName, value.calls]), [
            ["first", 1],
            ["Counter", 1],
            ["Counter", 2],
            ["Counter", 3],
        ]);
        assert.deepEqual(factoryValues([]), []);
    });
});

describe("buildInstance", () => {
    test("a factory class's instance is new each time, built with its constructor's arguments", () => {
        Counter.built = 0;
        const factory: FactoryInfo = {
            ...factoryOf("a.sim.ts", "Counter", []),
            method: "next",
            ownerParameters: [textParameter],
        };
        const startAtOne: IParameterBuilder = {
            build: (): unknown => 1,
        };
        const first = buildInstance(factory, Counter, startAtOne);
        assert.ok(first instanceof Counter);
        assert.notEqual(buildInstance(factory, Counter, startAtOne), first);
        assert.equal(Counter.built, 2);
        assert.equal(first.next(), 2);
    });

    test("a factory that is a function and not a method is a programmer error", () => {
        assert.throws(() => buildInstance(factoryOf("a.sim.ts", "first", []), Counter, builder), /is a function, not a class with a method/);
    });
});
