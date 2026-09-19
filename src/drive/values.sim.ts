// Scenarios for building the values a run passes to the code under test.
//
// What a stand-in answers turns on what is asked of it, and no made up call asks it anything. What
// the maker builds turns on the recipe it is given, and a recipe is a piece of a type rather than a
// value.

import type { Checklist, Injector } from "faultline";
import type { Recipe } from "../discover/recipes.ts";
import { RunSubject } from "../effects/subject.ts";
import { builtAround, CannotBuild, standIn, ValueMaker } from "./values.ts";

// Everything asked of a stand-in, which is everything code under test does to an argument.
export async function everythingAskedOfAStandIn(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const held = standIn({ values: ["kept", 7, true], properties: ["name", "at"], at: 0, given: new Map() }) as Record<string, unknown> & (() => unknown) & (new () => unknown);

    // A property the file being measured reads is answered with one of the values it tests against,
    // and the same question twice gets the same answer.
    if (held.name !== held.name) {
        throw new Error("TheStandInAnsweredOneQuestionTwoWays");
    }
    if (typeof held.name !== "string" && typeof held.name !== "number" && typeof held.name !== "boolean") {
        throw new Error("TheStandInDidNotAnswerWithAValueTheFileTestsAgainst");
    }
    if (held.at === undefined) {
        throw new Error("TheStandInAnsweredTheSecondPropertyWithNothing");
    }

    // A property it never reads is answered with another stand-in.
    if ((held.somethingElse as Record<string, unknown>).andAgain === undefined) {
        throw new Error("TheStandInDidNotAnswerAnUnknownPropertyWithAnother");
    }

    // Turning it into text goes several ways, and none of them refuses.
    if (typeof `${held as unknown as string}` !== "string") {
        throw new Error("TheStandInWouldNotGoIntoAString");
    }
    if (typeof String(held) !== "string") {
        throw new Error("TheStandInWouldNotBeMadeIntoAString");
    }
    if (typeof JSON.stringify({ held }) !== "string") {
        throw new Error("TheStandInWouldNotBeWrittenOut");
    }
    if (Object.prototype.toString.call(held).length === 0) {
        throw new Error("TheStandInSaidNothingAboutWhatItIs");
    }
    // Asked for each of them by name, because turning a value into text reaches only the first of
    // the three the runtime finds.
    if (typeof (held as unknown as { toString: () => string }).toString() !== "string") {
        throw new Error("TheStandInWouldNotSayWhatItIsAsText");
    }
    if (typeof (held as unknown as { valueOf: () => unknown }).valueOf() !== "string") {
        throw new Error("TheStandInWouldNotSayWhatItIsWorth");
    }
    // A symbol the runtime reads to decide what a value is, which answers with what the function
    // underneath has rather than another stand-in.
    if ((held as unknown as Record<symbol, unknown>)[Symbol.iterator] !== undefined) {
        throw new Error("TheStandInSaidItCouldBeLoopedOver");
    }

    // It can be called and built, and awaiting it finishes.
    held();
    void new held();
    if ((await (held as unknown as Promise<unknown>)) === undefined) {
        throw new Error("AwaitingTheStandInGaveNothing");
    }
    if (!("anything" in held)) {
        throw new Error("TheStandInSaidItHeldNothing");
    }

    // One with nothing to answer with falls back to another stand-in for every property.
    const bare = standIn() as Record<string, unknown>;
    if (bare.name === undefined) {
        throw new Error("TheBareStandInAnsweredWithNothing");
    }
}

// Every recipe the maker has something to build, including the ones it cannot.
export function everyRecipeTheMakerIsGiven(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const subject = new RunSubject(17, "clean");
    const recipes: Recipe[] = [
        { kind: "any" },
        { kind: "string" },
        { kind: "number" },
        { kind: "bigint" },
        { kind: "boolean" },
        { kind: "null" },
        { kind: "undefined" },
        { kind: "void" },
        { kind: "literal", value: "kept" },
        { kind: "literal", value: 7 },
        { kind: "literal", value: true },
        { kind: "union", options: [{ kind: "string" }, { kind: "number" }, { kind: "undefined" }] },
        { kind: "union", options: [] },
        { kind: "array", element: { kind: "string" } },
        { kind: "tuple", elements: [{ kind: "string" }, { kind: "number" }] },
        { kind: "object", properties: [{ name: "a", optional: false, recipe: { kind: "string" } }, { name: "b", optional: true, recipe: { kind: "number" } }] },
        { kind: "object", properties: [], index: { kind: "string" } },
        { kind: "map", key: { kind: "string" }, value: { kind: "number" } },
        { kind: "set", element: { kind: "string" } },
        { kind: "date" },
        { kind: "regexp" },
        { kind: "url" },
        { kind: "bytes" },
        { kind: "error" },
        { kind: "promise", value: { kind: "string" } },
        { kind: "function", returns: { kind: "number" } },
        { kind: "effect", effect: "injector" },
        { kind: "effect", effect: "checklist" },
        { kind: "effect", effect: "signal" },
        { kind: "named", key: "a#A", name: "A", structural: { kind: "object", properties: [{ name: "a", optional: false, recipe: { kind: "string" } }] } },
    ];
    // Several turns, because which entry of a list a turn takes and which way a choice goes are
    // both read off the turn.
    for (let turn = 0; turn < 8; turn += 1) {
        const maker = new ValueMaker(subject, [], turn, { tests: ["kept", 7], properties: ["a"] });
        for (const recipe of recipes) {
            maker.spoiled(maker.make(recipe));
        }
        maker.has("a#A");
    }
}

// The recipes the maker cannot build, which are what a test input factory is asked for.
export function theRecipesTheMakerCannotBuild(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const maker = new ValueMaker(new RunSubject(17, "clean"), [], 0);
    for (const recipe of [{ kind: "never" } as Recipe, { kind: "unknown", text: "symbol" } as Recipe, { kind: "union", options: [{ kind: "unknown", text: "symbol" }] } as Recipe]) {
        let refused = false;
        try {
            maker.make(recipe);
        }
        catch (thrown) {
            refused = thrown instanceof CannotBuild;
        }
        if (!refused) {
            throw new Error(`TheMakerBuiltSomethingItCannot_${recipe.kind}`);
        }
    }
    // An optional property whose recipe cannot be built is left out rather than stopping the call.
    maker.make({ kind: "object", properties: [{ name: "a", optional: true, recipe: { kind: "unknown", text: "symbol" } }] });
    // A named type with a factory that cannot build its own properties falls back to the factory.
    const factory = { key: "a#A", parameters: [], make: (): unknown => ({ name: "a" }) };
    const withFactory = new ValueMaker(new RunSubject(17, "clean"), [factory, { ...factory }], 0);
    for (let turn = 0; turn < 4; turn += 1) {
        withFactory.make({ kind: "named", key: "a#A", name: "A", structural: { kind: "unknown", text: "symbol" } });
    }

    // A factory that throws something other than a type the run cannot build. What it threw is what
    // the caller gets: a factory somebody wrote going wrong is theirs to see, not something to
    // build a value around.
    const refuses = {
        key: "a#Refuses",
        parameters: [],
        make: (): unknown => {
            throw new TypeError("ThisFactoryRefusesToBuildAnything");
        },
    };
    const around = new ValueMaker(new RunSubject(17, "clean"), [factory, refuses], 0);
    let said = "";
    for (let turn = 0; turn < 4; turn += 1) {
        try {
            around.make({
                kind: "named",
                key: "a#A",
                name: "A",
                structural: { kind: "named", key: "a#Refuses", name: "Refuses", structural: { kind: "object", properties: [] } },
            });
        }
        catch (thrown) {
            said = (thrown as Error).message;
        }
    }
    if (said !== "ThisFactoryRefusesToBuildAnything") {
        throw new Error("WhatAFactoryThrewWasNotHandedOn");
    }
}

// The function the run passes in, which throws and rejects so the code handling either is reached.
export async function theFunctionTheRunPassesIn(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    for (const failure of ["throws", "rejects"]) {
        const subject = new RunSubject(17, "clean");
        subject.injector.fail("calls", failure);
        const made = new ValueMaker(subject, [], 0).make({ kind: "function", returns: { kind: "number" } }) as () => unknown;
        try {
            const answer = made();
            if (answer instanceof Promise) {
                await answer;
            }
            throw new Error(`TheFunctionDidNot_${failure}`);
        }
        catch (thrown) {
            if (thrown instanceof Error && thrown.message.startsWith("TheFunctionDidNot")) {
                throw thrown;
            }
        }
    }
}

// A value arriving as nothing at all, whatever its type said.
export function aValueArrivingAsNothing(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    for (const failure of ["null", "undefined"]) {
        const subject = new RunSubject(17, "clean");
        subject.injector.fail("values", failure);
        const maker = new ValueMaker(subject, [], 0);
        const held = maker.spoiled("kept");
        if (held !== (failure === "null" ? null : undefined)) {
            throw new Error(`TheValueDidNotArriveAs_${failure}`);
        }
    }
}

// The strings a file's own names are built around.
export function theStringsBuiltAroundAFilesOwn(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const built = builtAround(["-", "", 7, true, "a string far too long to be a separator"]);
    if (!built.includes("1-2") || !built.includes("a-b")) {
        throw new Error("NothingWasBuiltAroundTheSeparator");
    }
    // The long one is there as itself, and nothing is built around it: a string that long is a
    // message rather than a separator.
    if (built.some((one) => one.startsWith("1") && one.includes("far too long"))) {
        throw new Error("SomethingWasBuiltAroundAStringThatIsNotASeparator");
    }
    if (builtAround([]).length === 0) {
        throw new Error("AFileNamingNothingWasGivenNothingAtAll");
    }
}
