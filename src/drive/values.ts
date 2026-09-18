// Builds the values a run passes to the code under test.
//
// Every value comes from this run's own seed, so two runs of the same seed pass the same
// arguments, and a failure is reproduced from the seed alone.

import type { Recipe } from "../discover/recipes.ts";
import type { RunSubject } from "../effects/subject.ts";

// Raised when a recipe describes something the run cannot build. The driver catches it and turns
// it into the line asking for a test input factory.
export class CannotBuild extends Error {
    // The type as the checker writes it. The report names it.
    readonly typeText: string;

    constructor(typeText: string) {
        super(`No value can be built for ${typeText}.`);
        this.name = "CannotBuild";
        this.typeText = typeText;
    }
}

// The strings a run tries. Each one is here because some piece of code treats it apart from the
// rest: the empty one, one that is only spaces, one that parses as a number, one that parses as
// JSON, one with a character outside the basic plane, and one long enough to cross a limit.
export const interestingStrings = [
    "",
    " ",
    "a",
    "hello",
    "Hello, World!",
    "0",
    "-1",
    "null",
    "true",
    "{}",
    '{"a":1}',
    "/tmp/a/path.txt",
    "https://example.com/thing?q=1",
    "  padded  ",
    "line\nbreak",
    "quote\"inside",
    "emoji \u{1f600} here",
    "x".repeat(1024),
];

// The numbers a run tries, for the same reason as the strings above: each is a value some piece of
// code treats apart from the rest.
export const interestingNumbers = [
    0, 1, -1, 2, 3, 10, 100, 1000, 0.5, -0.5, 1e21, 1e-7, -0,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    Number.MAX_VALUE,
    Number.EPSILON,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
];

// A factory the run can call to build one type.
export interface CallableFactory {
    // The key of the type it builds.
    key: string;

    // Builds one value. Anything it needs is built the same way every other value is.
    make: (maker: ValueMaker) => unknown;

    // The parameters it takes, so the maker can fill them.
    parameters: { recipe: Recipe; optional: boolean; rest: boolean }[];
}

// How many turns of the calling it takes to walk every list of values worth trying. A unit makes at
// most this many calls, and stops as soon as every path in the function has run.
export const mostTurns = Math.max(interestingStrings.length, interestingNumbers.length);

// How deep a built value goes. A recipe is already capped when it is read, and this stops a value
// built from a recipe that refers to itself through a factory.
const deepestValue = 8;

// Builds values from recipes, drawing everything it varies from one seed.
export class ValueMaker {
    // This run's effects, which is where a parameter of an effect type is filled from.
    readonly subject: RunSubject;

    // Every factory the sim files supplied, by the key of the type it builds.
    private readonly factories: Map<string, CallableFactory[]>;

    // How many values have been built. This walks a factory list rather than using only its first
    // entry.
    private built = 0;

    // Which turn of the calling this is. The lists of values worth trying are walked from here
    // rather than drawn from, so a branch on one particular value is reached by the turn that
    // reaches it rather than by luck.
    private readonly turn: number;

    // How many values worth trying have been handed out on this turn. Together with the turn it
    // says which entry comes next, so one call's several arguments are different values and the
    // next turn moves all of them on.
    private handedOut = 0;

    constructor(subject: RunSubject, factories: CallableFactory[], turn = 0) {
        this.turn = turn;
        this.subject = subject;
        this.factories = new Map();
        for (const one of factories) {
            const held = this.factories.get(one.key);
            if (held === undefined) {
                this.factories.set(one.key, [one]);
                continue;
            }
            held.push(one);
        }
    }

    // Whether a factory was supplied for this key.
    has(key: string): boolean {
        return this.factories.has(key);
    }

    // Builds one value, or throws `CannotBuild` when the recipe describes something it cannot.
    make(recipe: Recipe, depth = 0): unknown {
        const rng = this.subject.rng;
        if (depth > deepestValue) {
            return undefined;
        }
        switch (recipe.kind) {
            case "any":
                return this.make(rng.pick<Recipe>([
                    { kind: "string" },
                    { kind: "number" },
                    { kind: "boolean" },
                    { kind: "null" },
                    { kind: "undefined" },
                    { kind: "object", properties: [] },
                    { kind: "array", element: { kind: "number" } },
                ]), depth + 1);
            case "string":
                return this.worthTrying(interestingStrings);
            case "number":
                return this.worthTrying(interestingNumbers);
            case "bigint":
                return BigInt(rng.int(-1000, 1000));
            case "boolean":
                return rng.int(0, 1) === 1;
            case "null":
                return null;
            case "undefined":
            case "void":
                return undefined;
            case "literal":
                return recipe.value;
            case "union":
                return this.fromUnion(recipe.options, depth);
            case "array":
                return this.makeArray(recipe.element, depth);
            case "tuple":
                return recipe.elements.map((one) => this.make(one, depth + 1));
            case "object":
                return this.makeObject(recipe, depth);
            case "map":
                return this.makeMap(recipe.key, recipe.value, depth);
            case "set":
                return new Set(this.makeArray(recipe.element, depth) as unknown[]);
            case "date":
                return new Date(this.subject.clock.now() + rng.int(-86400000, 86400000));
            case "regexp":
                return new RegExp(rng.pick(["a", "^x.*", "[0-9]+", ".*"]));
            case "url":
                return new URL(rng.pick(["https://example.com/", "https://example.com/a/b?c=1", "file:///tmp/x"]));
            case "bytes":
                return rng.bytes(rng.int(0, 32));
            case "error":
                return new Error(rng.pick(interestingStrings));
            case "promise":
                return Promise.resolve(this.make(recipe.value, depth + 1));
            case "function":
                return this.makeFunction(recipe.returns, depth);
            case "effect":
                return this.effect(recipe.effect);
            case "named":
                return this.fromFactoryOrShape(recipe, depth);
            case "never":
                throw new CannotBuild("never");
            case "unknown":
                throw new CannotBuild(recipe.text);
        }
    }

    // Builds a value for a type a factory may have been supplied for.
    //
    // Every factory is used, and so are the type's own properties, in turn. Writing a factory adds
    // a value the run could not reach on its own, and never takes away one it already had.
    private fromFactoryOrShape(recipe: Recipe & { kind: "named" }, depth: number): unknown {
        const supplied = this.factories.get(recipe.key) ?? [];
        if (supplied.length === 0) {
            return this.make(recipe.structural, depth);
        }
        // The turn of the calling comes into this as well as how many values this call has already
        // built, so the next call uses the next factory rather than the same one every time.
        const at = (this.turn + this.built) % (supplied.length + 1);
        this.built += 1;
        if (at < supplied.length) {
            return supplied[at]!.make(this);
        }
        try {
            return this.make(recipe.structural, depth);
        }
        catch (thrown) {
            if (thrown instanceof CannotBuild) {
                // The type has no value its properties decide, which is the case a factory was
                // written for in the first place.
                return supplied[0]!.make(this);
            }
            throw thrown;
        }
    }

    // Picks one side of a union. An optional value is left out sometimes and given sometimes, so
    // the code that handles each is reached.
    private fromUnion(options: Recipe[], depth: number): unknown {
        if (options.length === 0) {
            return undefined;
        }
        const buildable: Recipe[] = [];
        for (const one of options) {
            if (one.kind === "unknown" || one.kind === "never") {
                continue;
            }
            buildable.push(one);
        }
        if (buildable.length === 0) {
            throw new CannotBuild(options.map((one) => one.kind).join(" | "));
        }
        return this.make(this.subject.rng.pick(buildable), depth + 1);
    }

    // Builds a list. The empty one is drawn often, because the code that handles an empty list is
    // written far more often than it is reached by an ordinary call.
    private makeArray(element: Recipe, depth: number): unknown {
        const count = this.subject.rng.pick([0, 0, 1, 1, 2, 3, 5]);
        const out: unknown[] = [];
        for (let index = 0; index < count; index += 1) {
            out.push(this.make(element, depth + 1));
        }
        return out;
    }

    // Builds an object from its properties. An optional property is left out about half the time.
    private makeObject(recipe: Recipe & { kind: "object" }, depth: number): unknown {
        const out: Record<string, unknown> = {};
        for (const property of recipe.properties) {
            if (property.optional && this.subject.rng.int(0, 1) === 0) {
                continue;
            }
            try {
                out[property.name] = this.make(property.recipe, depth + 1);
            }
            catch (thrown) {
                if (thrown instanceof CannotBuild && property.optional) {
                    continue;
                }
                throw thrown;
            }
        }
        if (recipe.index !== undefined) {
            const extra = this.subject.rng.int(0, 2);
            for (let index = 0; index < extra; index += 1) {
                out[this.subject.rng.pick(["a", "b", "c", "key", ""])] = this.make(recipe.index, depth + 1);
            }
        }
        return out;
    }

    // Builds a function to pass in. It answers until the injector says this call goes wrong, and
    // then it throws or rejects, which is how the code that handles a callback failing is reached.
    private makeFunction(returns: Recipe, depth: number): unknown {
        return (): unknown => {
            const gone = this.subject.injector.check("calls");
            if (gone === "throws") {
                throw new Error("The function the run passed in threw.");
            }
            if (gone === "rejects") {
                return Promise.reject(new Error("The function the run passed in rejected."));
            }
            return this.make(returns, depth + 1);
        };
    }

    // Takes the next entry of a list of values worth trying.
    //
    // The lists are walked rather than drawn from. A list holds every value some piece of code
    // treats apart from the rest, so walking it reaches a branch on `x === 0` on the turn that
    // reaches it, where drawing left it to luck and missed it about one short run in thirty.
    private worthTrying<T>(values: readonly T[]): T {
        const at = this.turn + this.handedOut;
        this.handedOut += 1;
        return values[at % values.length]!;
    }

    // Sometimes hands back nothing at all in place of a value, whatever the type said.
    //
    // A type says a parameter is a string and a running program hands it undefined anyway, which
    // is where a TypeError comes from. Nothing in a signature says it can happen, so the run has to
    // do it on purpose or the code that guards against it is never reached.
    spoiled(value: unknown): unknown {
        const gone = this.subject.injector.check("values");
        if (gone === "null") {
            return null;
        }
        if (gone === "undefined") {
            return undefined;
        }
        return value;
    }

    // Builds a map from the recipes for its keys and its values.
    private makeMap(key: Recipe, value: Recipe, depth: number): unknown {
        const out = new Map<unknown, unknown>();
        const count = this.subject.rng.pick([0, 0, 1, 2]);
        for (let index = 0; index < count; index += 1) {
            out.set(this.make(key, depth + 1), this.make(value, depth + 1));
        }
        return out;
    }

    // Hands back one of the effects this run owns.
    private effect(kind: string): unknown {
        switch (kind) {
            case "injector":
                return this.subject.injector;
            case "checklist":
                return this.subject.injector;
            case "signal":
                return this.signal();
            default:
                throw new CannotBuild(kind);
        }
    }

    // A signal that is sometimes already aborted, so the code that checks one is exercised both
    // ways without a scenario.
    private signal(): AbortSignal {
        if (this.subject.rng.int(1, 3) === 1) {
            return AbortSignal.abort(new Error("aborted by the run"));
        }
        return new AbortController().signal;
    }
}
