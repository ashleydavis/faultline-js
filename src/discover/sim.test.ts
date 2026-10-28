// Tests what is read out of a sim file: value factories by return type, scenarios and expectation
// functions by the type of their first parameter, type errors and which sim files a source file
// uses. Each test writes a small project in memory with a sim file, reads it through a real type
// checker and checks what came back. The project in memory declares the `faultline` package's
// contexts, so a sim file imports them as a project's own sim file does.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "@jest/globals";
import { fixture } from "./fixture.test.ts";
import { contextKindOf, readSim, simFilesFor, typeErrorsIn } from "./sim.ts";
import type { SimFacts } from "./sim.ts";
import type { FunctionInfo } from "./functions.ts";
import type { Recipe } from "./recipes.ts";
import type { Walked } from "./sources.ts";

// Writes the files, reads `a.sim.ts` and hands back what it offers.
export async function readOne(files: Record<string, string>): Promise<SimFacts> {
    const made = await fixture(files);
    return readSim(made.context, made.built.program, made.source("a.sim.ts"), "a.sim.ts");
}

// A function read from a sim file, with only the first parameter's recipe filled in, or with no
// parameter when `recipe` is undefined.
export function functionTaking(recipe: Recipe | undefined): FunctionInfo {
    const parameters = recipe === undefined ? [] : [
        {
            name: "first",
            typeName: "T",
            recipe,
            optional: false,
            rest: false,
        },
    ];
    return {
        label: "f",
        file: "a.sim.ts",
        line: 1,
        reach: {
            how: "export",
            name: "f",
        },
        parameters,
        async: false,
    };
}

// What a walk of a project at `/project` with these sim files would have found.
export function walkedWith(sims: string[], globalSims: string[]): Walked {
    return {
        sources: [],
        sims: new Map(sims.map((file) => [file, path.join("/project", file)])),
        globalSims,
        skipped: [],
    };
}

describe("readOne", () => {
    test("the sim file is read out of the files written", async () => {
        const facts = await readOne({
            "a.sim.ts": "export const a = 1;",
        });
        assert.equal(facts.file, "a.sim.ts");
        assert.deepEqual(facts.factories, []);
    });
});

describe("functionTaking", () => {
    test("the recipe is given to the one parameter", () => {
        const info = functionTaking({
            kind: "string",
        });
        assert.equal(info.parameters.length, 1);
        assert.deepEqual(info.parameters[0]?.recipe, {
            kind: "string",
        });
    });

    test("no recipe gives no parameter", () => {
        const info = functionTaking(undefined);
        assert.deepEqual(info.parameters, []);
        assert.equal(info.label, "f");
    });
});

describe("walkedWith", () => {
    test("every sim file is held under its path from the root", () => {
        const walked = walkedWith(["lib/a.sim.ts"], []);
        assert.equal(walked.sims.get("lib/a.sim.ts"), path.join("/project", "lib/a.sim.ts"));
        assert.deepEqual(walked.globalSims, []);
    });
});

describe("readSim", () => {
    test("a function in a sim file returning a type of the project's own is a value factory", async () => {
        const facts = await readOne({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { Thing } from "./a.ts";\nexport function aThing(): Thing { return { x: 1 }; }',
        });
        assert.equal(facts.factories.length, 1);
        assert.equal(facts.factories[0]?.key, "a.ts#Thing");
        assert.equal(facts.factories[0]?.exportName, "aThing");
        assert.equal(facts.factories[0]?.typeName, "Thing");
        assert.equal(facts.factories[0]?.file, "a.sim.ts");
        assert.deepEqual(facts.typeErrors, []);
    });

    test("several value factories for one type are each found, one per fault", async () => {
        assert.deepEqual((await readOne({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { Thing } from "./a.ts";\nexport function working(): Thing { return { x: 1 }; }\nexport function broken(): Thing { return { x: -1 }; }',
        })).factories.map((factory) => factory.exportName), ["working", "broken"]);
    });

    test("a value factory's own parameters are read so the run can fill them", async () => {
        assert.deepEqual((await readOne({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { Thing } from "./a.ts";\nexport function sized(x: number): Thing { return { x }; }',
        })).factories[0]?.parameters.map((parameter) => parameter.name), ["x"]);
    });

    test("a method on an exported class returning that type is a value factory that returns the next value of a sequence", async () => {
        const facts = await readOne({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { Thing } from "./a.ts";\nexport class Things {\n    count = 0;\n    constructor(start: number) { this.count = start; }\n    next(): Thing { this.count += 1; return { x: this.count }; }\n    static made(): Thing { return { x: 0 }; }\n}',
        });
        assert.equal(facts.factories.length, 1);
        const found = facts.factories[0];
        assert.equal(found?.method, "next");
        assert.equal(found?.key, "a.ts#Thing");
        assert.equal(found?.exportName, "Things");
        assert.deepEqual(found?.ownerParameters?.map((parameter) => parameter.name), ["start"]);
    });

    test("a method on a class the sim file keeps to itself is no value factory", async () => {
        assert.deepEqual((await readOne({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { Thing } from "./a.ts";\nclass Things { next(): Thing { return { x: 1 }; } }\nexport const a = 1;',
        })).factories, []);
    });

    test("a function returning a built-in value type is a value factory for that kind of value", async () => {
        assert.deepEqual((await readOne({
            "a.sim.ts": "export function aDate(): Date { return new Date(); }",
        })).factories, [
            {
                exportName: "aDate",
                file: "a.sim.ts",
                key: "builtin#Date",
                parameters: [],
                typeName: "Date",
            },
        ]);
    });

    test("a function returning a container from outside the project is no value factory", async () => {
        assert.deepEqual((await readOne({
            "a.sim.ts": "export function aList(): Map<string, number> { return new Map(); }",
        })).factories, []);
    });

    test("a helper the sim file keeps to itself is no value factory", async () => {
        assert.deepEqual((await readOne({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { Thing } from "./a.ts";\nfunction aThing(): Thing { return { x: 1 }; }\nexport const b = aThing;',
        })).factories, []);
    });

    test("a function taking a scenario context is a scenario, whatever it is called", async () => {
        const facts = await readOne({
            "a.sim.ts": 'import type { ScenarioContext } from "faultline";\nexport function anything(context: ScenarioContext) { void context; }',
        });
        assert.deepEqual(facts.scenarios, [
            {
                file: "a.sim.ts",
                exportName: "anything",
                line: 2,
            },
        ]);
        assert.deepEqual(facts.expectations, []);
        assert.deepEqual(facts.factories, []);
    });

    test("an async scenario is a scenario", async () => {
        assert.equal((await readOne({
            "a.sim.ts": 'import type { ScenarioContext } from "faultline";\nexport async function waits(context: ScenarioContext): Promise<void> { void context; }',
        })).scenarios.length, 1);
    });

    test("a function taking an expectation context is an expectation function, not a scenario", async () => {
        const facts = await readOne({
            "a.sim.ts": 'import type { ExpectationContext } from "faultline";\nexport function itHolds(context: ExpectationContext): void { void context; }',
        });
        assert.deepEqual(facts.scenarios, []);
        assert.deepEqual(facts.expectations, [
            {
                file: "a.sim.ts",
                exportName: "itHolds",
                line: 2,
            },
        ]);
    });

    test("a scenario that returns one of the project's own types is a scenario and never a value factory", async () => {
        const facts = await readOne({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { ScenarioContext } from "faultline";\nimport type { Thing } from "./a.ts";\nexport function both(context: ScenarioContext): Thing { void context; return { x: 1 }; }\nexport class Many { next(context: ScenarioContext): Thing { void context; return { x: 1 }; } }',
        });
        assert.equal(facts.scenarios.length, 1);
        assert.deepEqual(facts.factories, []);
    });

    test("a function taking no argument and giving back undefined is neither a scenario nor an expectation function", async () => {
        const facts = await readOne({
            "a.sim.ts": "export function itHolds(): void {}",
        });
        assert.deepEqual(facts.scenarios, []);
        assert.deepEqual(facts.expectations, []);
    });

    test("a helper the sim file keeps to itself is never a scenario, even when it takes a scenario context", async () => {
        assert.deepEqual((await readOne({
            "a.sim.ts": 'import type { ScenarioContext } from "faultline";\nfunction helper(context: ScenarioContext) { void context; }\nexport const used = helper;',
        })).scenarios, []);
    });

    test("a type merely called ScenarioContext does not make a scenario", async () => {
        assert.deepEqual((await readOne({
            "a.sim.ts": "interface ScenarioContext { y: number }\nexport function notAScenario(context: ScenarioContext) { void context; }",
        })).scenarios, []);
    });

    test("a function whose first parameter is supplied by the run but is no context is neither a scenario nor an expectation function", async () => {
        const facts = await readOne({
            "a.sim.ts": "export function waits(signal: AbortSignal) { void signal; }",
        });
        assert.deepEqual(facts.scenarios, []);
        assert.deepEqual(facts.expectations, []);
    });

    test("a function the checker gives no signature for is no value factory", async () => {
        // The checker gives no signature only for a node it did not parse, which a file read from
        // the project never holds, so the checker here is told to give none.
        const made = await fixture({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { Thing } from "./a.ts";\nexport function aThing(): Thing { return { x: 1 }; }',
        });
        made.context.checker = {
            ...made.context.checker,
            getSignatureFromDeclaration: () => undefined,
        };
        assert.deepEqual(readSim(made.context, made.built.program, made.source("a.sim.ts"), "a.sim.ts").factories, []);
    });

    test("a sim file that does not type-check is read and its errors are reported with file, line and column", async () => {
        const facts = await readOne({
            "a.ts": "export interface Thing { x: number }",
            "a.sim.ts": 'import type { Thing } from "./a.ts";\nexport function aThing(): Thing { return { x: "one" }; }',
        });
        assert.equal(facts.factories.length, 1);
        assert.equal(facts.typeErrors.length, 1);
        assert.match(facts.typeErrors[0] ?? "", /^a\.sim\.ts:2:\d+: Type 'string' is not assignable to type 'number'\.$/);
    });

    test("reading a file that is not a sim file is a programmer error", async () => {
        const made = await fixture({
            "a.ts": "export const a = 1;",
        });
        assert.throws(() => readSim(made.context, made.built.program, made.source("a.ts"), "a.ts"), /is not a sim file/);
    });
});

describe("typeErrorsIn", () => {
    test("a sim file that will not parse has its parse errors reported", async () => {
        const made = await fixture({
            "a.sim.ts": "export function broken( {",
        });
        const errors = typeErrorsIn(made.built.program, made.source("a.sim.ts"), made.root);
        assert.ok(errors.length > 0);
        assert.ok(errors.every((error) => error.startsWith("a.sim.ts:1:")));
    });
});

describe("contextKindOf", () => {
    test("the context a function takes is read from its first parameter's recipe", () => {
        assert.equal(contextKindOf(functionTaking({
            kind: "effect",
            effect: "scenario",
        })), "scenario");
        assert.equal(contextKindOf(functionTaking({
            kind: "effect",
            effect: "expectation",
        })), "expectation");
        assert.equal(contextKindOf(functionTaking({
            kind: "effect",
            effect: "signal",
        })), undefined);
        assert.equal(contextKindOf(functionTaking({
            kind: "string",
        })), undefined);
        assert.equal(contextKindOf(functionTaking(undefined)), undefined);
    });
});

describe("simFilesFor", () => {
    test("a source file uses the sim file beside it first, then every global.sim.ts", () => {
        assert.deepEqual(simFilesFor({
            file: "lib/a.ts",
            full: "/project/lib/a.ts",
            sim: "/project/lib/a.sim.ts",
        }, walkedWith(["lib/a.sim.ts", "global.sim.ts", "lib/global.sim.ts"], ["global.sim.ts", "lib/global.sim.ts"])), ["lib/a.sim.ts", "global.sim.ts", "lib/global.sim.ts"]);
    });

    test("a source file with no sim file beside it uses only the global ones", () => {
        const source = {
            file: "b.ts",
            full: "/project/b.ts",
        };
        assert.deepEqual(simFilesFor(source, walkedWith(["global.sim.ts"], ["global.sim.ts"])), ["global.sim.ts"]);
        assert.deepEqual(simFilesFor(source, walkedWith([], [])), []);
    });

    test("a global.ts uses its own global.sim.ts once", () => {
        assert.deepEqual(simFilesFor({
            file: "global.ts",
            full: "/project/global.ts",
            sim: "/project/global.sim.ts",
        }, walkedWith(["global.sim.ts"], ["global.sim.ts"])), ["global.sim.ts"]);
    });

    test("a sim file is no source file, so asking which sim files it uses is a programmer error", () => {
        assert.throws(() => simFilesFor({
            file: "a.sim.ts",
            full: "/project/a.sim.ts",
        }, walkedWith([], [])));
    });
});
