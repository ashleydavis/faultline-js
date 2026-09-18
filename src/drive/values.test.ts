import assert from "node:assert/strict";
import test from "node:test";
import { RunSubject } from "../effects/subject.ts";
import type { Recipe } from "../discover/recipes.ts";
import { CannotBuild, interestingNumbers, interestingStrings, ValueMaker } from "./values.ts";

// A maker wired to one seed, with the factories a test hands it.
function maker(seed = 1, factories: ConstructorParameters<typeof ValueMaker>[1] = []): ValueMaker {
    return new ValueMaker(new RunSubject(seed, "clean"), factories);
}

// Every value one recipe builds over a run of draws.
function many(recipe: Recipe, count = 200, seed = 1): unknown[] {
    const one = maker(seed);
    const out: unknown[] = [];
    for (let index = 0; index < count; index += 1) {
        out.push(one.make(recipe));
    }
    return out;
}

test("each primitive is built as itself", () => {
    assert.equal(typeof maker().make({ kind: "string" }), "string");
    assert.equal(typeof maker().make({ kind: "number" }), "number");
    assert.equal(typeof maker().make({ kind: "boolean" }), "boolean");
    assert.equal(typeof maker().make({ kind: "bigint" }), "bigint");
    assert.equal(maker().make({ kind: "null" }), null);
    assert.equal(maker().make({ kind: "undefined" }), undefined);
    assert.equal(maker().make({ kind: "void" }), undefined);
});

test("a string comes from the list of the ones worth trying", () => {
    for (const drawn of many({ kind: "string" })) {
        assert.ok(interestingStrings.includes(drawn as string));
    }
});

test("every string worth trying is reached over a run of draws", () => {
    assert.equal(new Set(many({ kind: "string" }, 2000)).size, interestingStrings.length);
});

test("every number worth trying is reached over a run of draws", () => {
    assert.equal(new Set(many({ kind: "number" }, 2000)).size, interestingNumbers.length - 1);
});

test("both sides of a boolean are reached", () => {
    assert.equal(new Set(many({ kind: "boolean" })).size, 2);
});

test("a literal is built as the one value it is", () => {
    assert.equal(maker().make({ kind: "literal", value: "x" }), "x");
    assert.equal(maker().make({ kind: "literal", value: 7 }), 7);
});

test("a union reaches every side of itself", () => {
    const drawn = many({ kind: "union", options: [{ kind: "literal", value: "a" }, { kind: "literal", value: "b" }] });
    assert.deepEqual([...new Set(drawn)].sort(), ["a", "b"]);
});

test("a union with a side no value can be built for uses the sides that can", () => {
    const drawn = maker().make({
        kind: "union",
        options: [{ kind: "unknown", text: "symbol" }, { kind: "literal", value: "a" }],
    });
    assert.equal(drawn, "a");
});

test("a union with no side that can be built says so", () => {
    assert.throws(
        () => maker().make({ kind: "union", options: [{ kind: "unknown", text: "symbol" }] }),
        CannotBuild,
    );
});

test("an empty union is built as nothing at all", () => {
    assert.equal(maker().make({ kind: "union", options: [] }), undefined);
});

test("a list is built with what it holds, and is sometimes empty", () => {
    const drawn = many({ kind: "array", element: { kind: "number" } }, 200) as unknown[][];
    assert.ok(drawn.every((one) => Array.isArray(one)));
    assert.ok(drawn.some((one) => one.length === 0), "no empty list was built");
    assert.ok(drawn.some((one) => one.length > 0), "every list was empty");
    assert.ok(drawn.every((one) => one.every((item) => typeof item === "number")));
});

test("a tuple is built element by element", () => {
    const drawn = maker().make({ kind: "tuple", elements: [{ kind: "literal", value: 1 }, { kind: "literal", value: "a" }] });
    assert.deepEqual(drawn, [1, "a"]);
});

test("an object carries every property it must have", () => {
    const drawn = maker().make({
        kind: "object",
        properties: [{ name: "x", recipe: { kind: "literal", value: 1 }, optional: false }],
    }) as Record<string, unknown>;
    assert.deepEqual(drawn, { x: 1 });
});

test("an optional property is left out sometimes and given sometimes", () => {
    const recipe: Recipe = {
        kind: "object",
        properties: [{ name: "x", recipe: { kind: "literal", value: 1 }, optional: true }],
    };
    const drawn = many(recipe, 100) as Record<string, unknown>[];
    assert.ok(drawn.some((one) => "x" in one), "the property was never given");
    assert.ok(drawn.some((one) => !("x" in one)), "the property was always given");
});

test("an optional property that cannot be built is left out rather than stopping the call", () => {
    const drawn = maker().make({
        kind: "object",
        properties: [{ name: "x", recipe: { kind: "unknown", text: "symbol" }, optional: true }],
    });
    assert.deepEqual(drawn, {});
});

test("a property that must be there and cannot be built stops the call", () => {
    assert.throws(
        () =>
            maker().make({
                kind: "object",
                properties: [{ name: "x", recipe: { kind: "unknown", text: "symbol" }, optional: false }],
            }),
        CannotBuild,
    );
});

test("an index signature puts extra entries in", () => {
    const drawn = many({ kind: "object", properties: [], index: { kind: "literal", value: 1 } }, 50) as Record<string, unknown>[];
    assert.ok(drawn.some((one) => Object.keys(one).length > 0));
});

test("a map and a set are built with what they hold", () => {
    const asMap = maker().make({ kind: "map", key: { kind: "string" }, value: { kind: "number" } });
    assert.ok(asMap instanceof Map);
    const asSet = maker().make({ kind: "set", element: { kind: "number" } });
    assert.ok(asSet instanceof Set);
});

test("the types every runtime already has are each built as themselves", () => {
    assert.ok(maker().make({ kind: "date" }) instanceof Date);
    assert.ok(maker().make({ kind: "regexp" }) instanceof RegExp);
    assert.ok(maker().make({ kind: "url" }) instanceof URL);
    assert.ok(maker().make({ kind: "bytes" }) instanceof Uint8Array);
    assert.ok(maker().make({ kind: "error" }) instanceof Error);
});

test("a promise resolves to what it was built to hold", async () => {
    const drawn = maker().make({ kind: "promise", value: { kind: "literal", value: 4 } });
    assert.equal(await drawn, 4);
});

test("a function is built, and returns what it was built to return", () => {
    const drawn = maker().make({ kind: "function", returns: { kind: "literal", value: 4 } }) as () => unknown;
    assert.equal(typeof drawn, "function");
    assert.equal(drawn(), 4);
});

test("a function the run passed in throws when the injector says so", () => {
    const one = maker();
    const drawn = one.make({ kind: "function", returns: { kind: "literal", value: 4 } }) as () => unknown;
    one.subject.injector.fail("calls", "throws");
    assert.throws(drawn, /passed in threw/);
});

test("a function the run passed in rejects when the injector says so", async () => {
    const one = maker();
    const drawn = one.make({ kind: "function", returns: { kind: "literal", value: 4 } }) as () => unknown;
    one.subject.injector.fail("calls", "rejects");
    await assert.rejects(drawn() as Promise<unknown>, /passed in rejected/);
});

test("a function the run passed in throws and rejects over a faulting run, and answers as well", () => {
    const one = new ValueMaker(new RunSubject(4, "faulting"), []);
    const drawn = one.make({ kind: "function", returns: { kind: "literal", value: 4 } }) as () => unknown;
    let answered = 0;
    let went = 0;
    for (let index = 0; index < 400; index += 1) {
        try {
            const back = drawn();
            if (back instanceof Promise) {
                back.catch(() => undefined);
                went += 1;
                continue;
            }
            answered += 1;
        }
        catch {
            went += 1;
        }
    }
    assert.ok(answered > 0, "it never answered");
    assert.ok(went > 0, "it never went wrong");
});

test("a value arrives as nothing at all when the injector says so, whatever its type said", () => {
    const one = maker();
    one.subject.injector.fail("values", "null");
    assert.equal(one.spoiled("a string"), null);
    one.subject.injector.fail("values", "undefined");
    assert.equal(one.spoiled("a string"), undefined);
});

test("a value is left alone when the injector says nothing", () => {
    assert.equal(maker().spoiled("a string"), "a string");
});

test("a faulting run spoils some values and leaves most alone", () => {
    const one = new ValueMaker(new RunSubject(6, "faulting"), []);
    let spoiled = 0;
    for (let index = 0; index < 800; index += 1) {
        if (one.spoiled("a string") !== "a string") {
            spoiled += 1;
        }
    }
    assert.ok(spoiled > 0, "no value was spoiled");
    assert.ok(spoiled < 400, "spoiling one value in two costs more calls than it buys paths");
});

test("the injector a scenario takes is the run's own", () => {
    const one = maker();
    assert.equal(one.make({ kind: "effect", effect: "injector" }), one.subject.injector);
});

test("a signal is sometimes already aborted and sometimes not", () => {
    const drawn = many({ kind: "effect", effect: "signal" }, 100) as AbortSignal[];
    assert.ok(drawn.some((one) => one.aborted), "no signal was aborted");
    assert.ok(drawn.some((one) => !one.aborted), "every signal was aborted");
});

test("a type with no factory is built from the properties it has", () => {
    const drawn = maker().make({
        kind: "named",
        key: "a.ts#Thing",
        name: "Thing",
        structural: { kind: "object", properties: [{ name: "x", recipe: { kind: "literal", value: 1 }, optional: false }] },
    });
    assert.deepEqual(drawn, { x: 1 });
});

test("a factory is used where one was supplied", () => {
    const one = maker(1, [{ key: "a.ts#Thing", parameters: [], make: () => "from the factory" }]);
    assert.equal(
        one.make({ kind: "named", key: "a.ts#Thing", name: "Thing", structural: { kind: "object", properties: [] } }),
        "from the factory",
    );
});

test("every factory for one type is used, not only the first", () => {
    const one = maker(1, [
        { key: "k", parameters: [], make: () => "first" },
        { key: "k", parameters: [], make: () => "second" },
    ]);
    const recipe: Recipe = { kind: "named", key: "k", name: "T", structural: { kind: "object", properties: [] } };
    assert.deepEqual([one.make(recipe), one.make(recipe)], ["first", "second"]);
});

test("the type's own properties stay in the turn, so a factory adds a value and takes none away", () => {
    const one = maker(1, [{ key: "k", parameters: [], make: () => "from the factory" }]);
    const recipe: Recipe = {
        kind: "named",
        key: "k",
        name: "T",
        structural: { kind: "object", properties: [{ name: "x", recipe: { kind: "literal", value: 1 }, optional: false }] },
    };
    assert.deepEqual([one.make(recipe), one.make(recipe)], ["from the factory", { x: 1 }]);
});

test("a type whose properties decide no value falls back to a factory", () => {
    const one = maker(1, [{ key: "k", parameters: [], make: () => "from the factory" }]);
    const recipe: Recipe = { kind: "named", key: "k", name: "T", structural: { kind: "unknown", text: "symbol" } };
    assert.deepEqual([one.make(recipe), one.make(recipe)], ["from the factory", "from the factory"]);
});

test("whether a factory was supplied can be asked", () => {
    const one = maker(1, [{ key: "k", parameters: [], make: () => 1 }]);
    assert.equal(one.has("k"), true);
    assert.equal(one.has("other"), false);
});

test("a type no value can be built for says which type it was", () => {
    assert.throws(() => maker().make({ kind: "unknown", text: "symbol" }), (thrown: CannotBuild) => thrown.typeText === "symbol");
    assert.throws(() => maker().make({ kind: "never" }), CannotBuild);
});

test("a recipe that goes on for ever stops rather than filling the stack", () => {
    const loop = { kind: "object", properties: [] } as Recipe & { kind: "object" };
    loop.properties.push({ name: "self", recipe: loop, optional: false });
    assert.doesNotThrow(() => maker().make(loop));
});

test("two makers on one seed build the same values", () => {
    const recipe: Recipe = { kind: "array", element: { kind: "string" } };
    assert.deepEqual(many(recipe, 50, 8), many(recipe, 50, 8));
});
