//
// Checks how a shard is read: a source file gives its functions and the conditions in each, a sim
// file gives only what the sim files offer, a file no `tsconfig.json` owns is read with the
// defaults, a file that does not parse gives what the compiler said and the program of the last
// shard under a config is kept for the next. The project is
// held in a file system in memory and compiled with the tests' own small library. Also checks
// which functions' code paths a function waits for before Faultline stops calling it, on functions
// written out in the test.
//

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import type { FunctionInfo, Reach } from "../discover/functions.ts";
import { createCompilerHost } from "../discover/program.ts";
import { createFakeFileSystem, testConfig, testLibrary } from "../lib/fake-files.test.ts";
import { createReading, untilKnown } from "../lib/known-files.ts";
import { childrenOf, conditionsByFunction, functionKey, reachingFunction, readShard, sourceOf, targetLabels, type ProgramsByConfig } from "./shard.ts";

//
// Where the project sits. Any absolute path does, because the file system in memory holds nothing
// else.
//
const root = "/project";

//
// The project: one directory a `tsconfig.json` owns and one no `tsconfig.json` owns.
//
const files = createFakeFileSystem({
    [path.join(root, "package.json")]: "{ \"name\": \"project\", \"type\": \"module\" }\n",
    [path.join(root, "node_modules", "@types", "test-library", "index.d.ts")]: testLibrary,
    [path.join(root, "app", "tsconfig.json")]: testConfig,
    [path.join(root, "app", "pick.ts")]: "const limit = 3;\nif (limit > 2) {\n}\nexport function pick(value: number): string {\n    function inner(text: string): boolean {\n        return text === \"x\";\n    }\n    return value > limit && inner(\"y\") ? \"big\" : \"small\";\n}\n",
    [path.join(root, "app", "pick.sim.ts")]: "export function makeNumber(): number {\n    return 1;\n}\n",
    [path.join(root, "loose", "loose.ts")]: "export function one(): number {\n    return 1;\n}\n",
    [path.join(root, "loose", "unparsed.ts")]: "export function broken( {\n",
});

//
// A program over `rootNames` in the project in memory, with the tests' own library.
//
export function programOver(rootNames: string[]): Promise<ts.Program> {
    const reading = createReading(files);
    return untilKnown(reading, () => ts.createProgram({
        rootNames,
        options: {
            noLib: true,
            types: ["test-library"],
        },
        host: createCompilerHost(reading.known),
    }));
}

//
// A function written out in the test: `label`, reached as `reach`, inside `within` when given.
//
export function functionInfoOf(label: string, reach: Reach, within: string | undefined): FunctionInfo {
    return {
        label,
        file: "a.ts",
        line: 1,
        reach,
        within,
        parameters: [],
        async: false,
    };
}

//
// How a function written inside another is reached, which Faultline cannot call.
//
const inside: Reach = {
    how: "inside",
    because: "it is written inside another function",
};

//
// How an exported function is reached, which Faultline calls.
//
const exported: Reach = {
    how: "export",
    name: "f",
};

//
// The functions of a file written out for `targetLabels` and `reachingFunction`: two it can call,
// a chain inside one of them, one inside no function, one inside a function the file does not have,
// two inside each other and a second function with the label of the first.
//
const functions = [
    functionInfoOf("f", exported, undefined),
    functionInfoOf("g", exported, undefined),
    functionInfoOf("f.inner", inside, "f"),
    functionInfoOf("f.inner.deeper", inside, "f.inner"),
    functionInfoOf("loose", inside, undefined),
    functionInfoOf("lost", inside, "missing"),
    functionInfoOf("loop.a", inside, "loop.b"),
    functionInfoOf("loop.b", inside, "loop.a"),
    functionInfoOf("f", exported, undefined),
];

//
// The function written out above with `label`, which is one of them.
//
export function writtenFunction(label: string): FunctionInfo {
    const found = functions.find((written) => written.label === label);
    assert(found);
    return found;
}

describe("readShard", () => {
    test("a sim file using what another file of the config declares for every file has no type errors", async () => {
        const augmented = createFakeFileSystem({
            [path.join(root, "node_modules", "@types", "test-library", "index.d.ts")]: testLibrary,
            [path.join(root, "app", "tsconfig.json")]: testConfig,
            [path.join(root, "app", "globals.ts")]: "declare global {\n    interface Caller {\n        user: string;\n    }\n}\nexport {};\n",
            [path.join(root, "app", "greet.ts")]: "export function greet(caller: Caller): string {\n    return caller.user;\n}\n",
            [path.join(root, "app", "greet.sim.ts")]: "export function buildCaller(): Caller {\n    return {\n        user: \"someone\",\n    };\n}\n",
        });
        const shard = await readShard(createReading(augmented), root, [], "app/greet.ts", ["app/greet.sim.ts"], new Map());
        assert.deepEqual(shard.sims[0]?.typeErrors, []);
        assert.deepEqual(shard.facts?.functions.map((found) => found.label), ["(top level)", "greet"]);
    });

    test("a source file gives its functions and their conditions, and its program is kept under its config", async () => {
        const programs: ProgramsByConfig = new Map();
        const reading = createReading(files);
        const shard = await readShard(reading, root, [], "app/pick.ts", ["app/pick.sim.ts"], programs);
        assert.deepEqual(shard.facts?.functions.map((found) => found.label), ["(top level)", "pick", "inner"]);
        assert.deepEqual(shard.sims.map((sim) => sim.file), ["app/pick.sim.ts"]);
        assert.deepEqual(shard.conditions.get(functionKey("pick", 4))?.map((condition) => condition.line), [6, 8]);
        assert.deepEqual(shard.conditions.get(functionKey("(top level)", 1))?.map((condition) => condition.line), [2]);
        assert.deepEqual([...programs.keys()], [path.join(root, "app", "tsconfig.json")]);
        const first = programs.get(path.join(root, "app", "tsconfig.json"));
        await readShard(reading, root, [], "app/pick.sim.ts", ["app/pick.sim.ts"], programs);
        assert.notEqual(programs.get(path.join(root, "app", "tsconfig.json")), first);
    });

    test("a sim file gives what it offers and no functions of its own", async () => {
        const shard = await readShard(createReading(files), root, [], "app/pick.sim.ts", ["app/pick.sim.ts"], new Map());
        assert.equal(shard.facts, undefined);
        assert.deepEqual(shard.sims[0]?.factories.map((factory) => factory.exportName), ["makeNumber"]);
        assert.equal(shard.conditions.size, 0);
    });

    test("a file no tsconfig.json owns is read with the defaults, under the empty key", async () => {
        const programs: ProgramsByConfig = new Map();
        const shard = await readShard(createReading(files), root, [], "loose/loose.ts", [], programs);
        assert.deepEqual(shard.facts?.functions.map((found) => found.label), ["(top level)", "one"]);
        assert.deepEqual([...programs.keys()], [""]);
    });

    test("a source file that does not parse gives what the compiler said, with the file, line and column, and one that parses gives none", async () => {
        const broken = await readShard(createReading(files), root, [], "loose/unparsed.ts", [], new Map());
        assert.equal(broken.parseErrors.length, 1);
        assert.match(broken.parseErrors[0] ?? "", /^loose\/unparsed\.ts:2:1: /);
        const parsed = await readShard(createReading(files), root, [], "loose/loose.ts", [], new Map());
        assert.deepEqual(parsed.parseErrors, []);
        const sim = await readShard(createReading(files), root, [], "app/pick.sim.ts", ["app/pick.sim.ts"], new Map());
        assert.deepEqual(sim.parseErrors, []);
    });

    test("a shard named by an absolute path is a defect in the run", async () => {
        await assert.rejects(readShard(createReading(files), root, [], path.join(root, "loose", "loose.ts"), [], new Map()), /is not relative to the project root/);
    });
});

describe("sourceOf", () => {
    test("a program hands back a file it read and refuses one it did not", async () => {
        const program = await programOver([path.join(root, "loose", "loose.ts")]);
        assert.equal(sourceOf(program, path.join(root, "loose", "loose.ts")).fileName, path.join(root, "loose", "loose.ts"));
        assert.throws(() => sourceOf(program, path.join(root, "gone.ts")), /The program has no file/);
    });
});

describe("functionKey", () => {
    test("a function's key is its label and its line, and a line before the first is refused", () => {
        assert.equal(functionKey("Reader.read", 12), "Reader.read@12");
        assert.throws(() => functionKey("Reader.read", 0));
        assert.throws(() => functionKey("", 1));
    });
});

describe("conditionsByFunction", () => {
    test("the conditions of every reported function are read, nested ones included, in the order written", async () => {
        const program = await programOver([path.join(root, "app", "pick.ts")]);
        const found = conditionsByFunction(program.getTypeChecker(), sourceOf(program, path.join(root, "app", "pick.ts")));
        assert.deepEqual([...found.keys()], ["(top level)@1", "pick@4", "inner@5"]);
        assert.deepEqual(found.get("inner@5")?.map((condition) => condition.line), [6]);
    });
});

describe("childrenOf", () => {
    test("every child of a node is given, in the order written, and a leaf has none", () => {
        const source = ts.createSourceFile("/project/a.ts", "const first = 1;\nconst second = 2;\n", ts.ScriptTarget.Latest, true);
        const statements = childrenOf(source).filter((child) => ts.isVariableStatement(child));
        assert.deepEqual(statements.map((statement) => statement.getText(source)), ["const first = 1;", "const second = 2;"]);
        assert.deepEqual(childrenOf(source.endOfFileToken), []);
    });
});

describe("targetLabels", () => {
    test("a function waits for its own paths, those of what only it reaches and those of what no function in particular reaches", () => {
        assert.deepEqual(targetLabels(functions, "f"), ["f", "f.inner", "f.inner.deeper", "loose", "lost", "loop.a", "loop.b"]);
        assert.deepEqual(targetLabels(functions, "g"), ["g", "loose", "lost", "loop.a", "loop.b"]);
    });

    test("a function Faultline cannot call waits for its own paths and is not listed twice", () => {
        assert.deepEqual(targetLabels(functions, "f.inner"), ["f.inner", "loose", "lost", "loop.a", "loop.b"]);
        assert.deepEqual(targetLabels([], "f"), ["f"]);
    });
});

describe("reachingFunction", () => {
    test("the function reaching one Faultline cannot call is the nearest one around it that it can call", () => {
        const byLabel = new Map(functions.map((written) => [written.label, written]));
        assert.equal(reachingFunction(byLabel, writtenFunction("f.inner.deeper")), "f");
        assert.equal(reachingFunction(byLabel, writtenFunction("loose")), undefined);
        assert.equal(reachingFunction(byLabel, writtenFunction("lost")), undefined);
        assert.equal(reachingFunction(byLabel, writtenFunction("loop.a")), undefined);
    });

    test("a function Faultline can call is not asked about", () => {
        const byLabel = new Map(functions.map((written) => [written.label, written]));
        assert.throws(() => reachingFunction(byLabel, writtenFunction("g")));
    });
});
