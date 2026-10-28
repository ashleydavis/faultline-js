//
// Tests for reading what V8 says ran. The pieces are tested on ranges and maps written out in the
// tests. The whole is tested against V8 itself: a file is transpiled the way the loader does it and
// run in this process with precise coverage on. The code paths each call exercised are read back
// after every call, so each kind of path, the mapping through the source map and the reset between
// calls are what V8 reports and not what a test assumed. A file loaded through the module hooks in
// a Node process of its own is checked by `src/smoke/coverage-per-call.smoke.ts`.
//

import assert from "node:assert/strict";
import { Session } from "node:inspector/promises";
import path from "node:path";
import vm from "node:vm";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import { transpile } from "../load/hooks.ts";
import { pathsIn, type PathSite, type Paths } from "./paths.ts";
import {
    countAt,
    exercisedPaths,
    inlineMapOf,
    measureFile,
    Offsets,
    Places,
    startCoverage,
    takeCoverage,
    type MeasuredFile,
    type ScriptCoverage,
} from "./v8.ts";

//
// One script written the way V8 reports it, with the ranges given outermost first.
//
export function script(url: string, ranges: [number, number, number][]): ScriptCoverage {
    return {
        url,
        functions: [
            {
                functionName: "",
                ranges: ranges.map(([startOffset, endOffset, count]) => ({
                    startOffset,
                    endOffset,
                    count,
                })),
            },
        ],
    };
}

//
// A source map naming `sources` with `mappings`, written as JSON the way a transpile writes one.
//
export function sourceMapOf(sources: string[], mappings: string): string {
    return JSON.stringify({
        version: 3,
        sources,
        names: [],
        mappings,
    });
}

describe("countAt", () => {
    test("the count at an offset is the count of the narrowest range covering it", () => {
        const held = script("file:///a.js", [[0, 100, 5], [40, 60, 2]]);
        assert.equal(countAt(held, 10), 5);
        assert.equal(countAt(held, 45), 2);
    });

    test("an offset no range covers sits in a function that never ran", () => {
        assert.equal(countAt(script("file:///a.js", [[0, 10, 3]]), 50), 0);
    });

    test("a wider range listed after a narrower one does not take its place", () => {
        const held = script("file:///a.js", [[40, 60, 2], [0, 100, 5]]);
        assert.equal(countAt(held, 45), 2);
    });
});

describe("Offsets", () => {
    test("an offset counts the characters of every line before it", () => {
        const offsets = new Offsets("ab\ncd\nef");
        assert.equal(offsets.offsetOf(1, 0), 0);
        assert.equal(offsets.offsetOf(2, 1), 4);
        assert.equal(offsets.offsetOf(3, 0), 6);
    });

    test("a line the file does not have is nowhere", () => {
        assert.equal(new Offsets("ab").offsetOf(9, 0), -1);
    });
});

describe("inlineMapOf", () => {
    test("a map inside the file is read out of the end of it", () => {
        const text = `first\n//# sourceMappingURL=data:application/json;base64,${Buffer.from('{"k":1}').toString("base64")}\n`;
        assert.equal(inlineMapOf(text), '{"k":1}');
    });

    test("a file carrying no map has none to read", () => {
        assert.equal(inlineMapOf("first\n"), undefined);
    });
});

describe("Places", () => {
    test("a position in the source is found in the file that ran", () => {
        //
        // Two mappings: the start of the source is the start of the generated file, and line 2
        // column 0 of the source is line 1 column 4 of it.
        //
        const places = new Places(sourceMapOf(["a.ts"], "AAAA,IACA"), "0123456789\n");
        assert.equal(places.generatedOffsetOf(2, 0), 4);
    });

    test("a position the transpile left nowhere is answered with nothing", () => {
        assert.equal(new Places(sourceMapOf(["a.ts"], ""), "first\n").generatedOffsetOf(5, 0), -1);
    });

    test("a map naming no source finds no position", () => {
        assert.equal(new Places(sourceMapOf([], ""), "first\n").generatedOffsetOf(1, 0), -1);
    });
});

//
// A file with one of every kind of code path, each on a line of its own so a test can name it.
//
const everyKind = [
    "export function kinds(value: number, box?: { count?: number }, flag = true) {",
    "    let total = 0;",
    "    if (value > 0) {",
    "        total += 1;",
    "    }",
    "    const sign = value > 0 ? \"plus\" : \"minus\";",
    "    const both = value > 1 && flag;",
    "    const either = value > 2 || flag;",
    "    const given = box?.count ?? 5;",
    "    switch (value) {",
    "        case 1:",
    "            total += 2;",
    "            break;",
    "        default:",
    "            total += 3;",
    "    }",
    "    for (let index = 0; index < value; index += 1) {",
    "        total += index;",
    "    }",
    "    try {",
    "        if (value > 3) {",
    "            throw new Error(\"big\");",
    "        }",
    "    }",
    "    catch {",
    "        total = -1;",
    "    }",
    "    return [total, sign, both, either, given];",
    "}",
    "",
].join("\n");

//
// The code paths of a file, read the way a run reads them.
//
export function pathsOf(file: string, text: string): Paths {
    return pathsIn(ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true), path.basename(file));
}

//
// A file transpiled the way the loader transpiles it, measured, run in a context of its own under
// `url` and handed back with what it exports.
//
export interface IRunFile {
    //
    // The file's code paths, found in the text that ran.
    //
    measured: MeasuredFile;

    //
    // What the file exports.
    //
    exports: Record<string, (...values: unknown[]) => unknown>;
}

//
// Runs `text` under `url` in this process, so V8 counts it.
//
export function runFile(url: string, text: string): IRunFile {
    const file = new URL(url).pathname;
    const loaded = transpile(file, text, {
        target: ts.ScriptTarget.ES2022,
    }, "commonjs");
    const measured = measureFile(url, loaded, pathsOf(file, text));
    const exports: Record<string, (...values: unknown[]) => unknown> = {};
    vm.runInNewContext(loaded, {
        exports,
    }, {
        filename: url,
    });
    return {
        measured,
        exports,
    };
}

//
// The function a file that ran exports as `name`, which it has to export.
//
export function exportedFunction(ran: IRunFile, name: string): (...values: unknown[]) => unknown {
    const exported = ran.exports[name];
    assert(exported, `The file exports no ${name}.`);
    return exported;
}

//
// The names of the code paths in one reading.
//
export async function exercisedNames(session: Session, measured: MeasuredFile): Promise<string[]> {
    return exercisedPaths(await takeCoverage(session), measured).map((exercised) => exercised.name);
}

describe("reading V8 after every call", () => {
    test("each kind of code path is read from the call that exercised it, and each reading starts from nothing", async () => {
        const session = new Session();
        session.connect();
        try {
            await startCoverage(session);
            const ran = runFile("file:///virtual/every-kind.ts", everyKind);
            const measured = ran.measured;
            assert.deepEqual(measured.notProvable.map((notProvable) => notProvable.name), ["default:1:flag"]);
            assert.deepEqual(await exercisedNames(session, measured), ["(top level):entered"]);
            const kinds = exportedFunction(ran, "kinds");

            kinds(0);
            const first = await exercisedNames(session, measured);
            assert.deepEqual(first, [
                "kinds:entered",
                "if:3:false",
                "ternary:6:false",
                "logic:7:&&:short",
                "logic:8:||:taken",
                "logic:9:??:taken",
                "chain:9:23:skipped",
                "case:14:default",
                "if:21:false",
            ]);

            kinds(1, {
                count: 2,
            }, false);
            assert.deepEqual(await exercisedNames(session, measured), [
                "kinds:entered",
                "if:3:true",
                "ternary:6:true",
                "logic:7:&&:short",
                "logic:8:||:taken",
                "logic:9:??:short",
                "chain:9:23:read",
                "case:11",
                "loop:17:body",
                "if:21:false",
            ]);

            kinds(5, {});
            assert.deepEqual(await exercisedNames(session, measured), [
                "kinds:entered",
                "if:3:true",
                "ternary:6:true",
                "logic:7:&&:taken",
                "logic:8:||:short",
                "logic:9:??:taken",
                "chain:9:23:read",
                "case:14:default",
                "loop:17:body",
                "if:21:true",
                "catch:25",
            ]);

            //
            // The same call again reads the same paths, because the last reading reset the
            // counters.
            //
            kinds(0);
            assert.deepEqual(await exercisedNames(session, measured), first);

            //
            // A reading with no call in it exercised no path at all.
            //
            assert.deepEqual(await exercisedNames(session, measured), []);
        }
        finally {
            session.disconnect();
        }
    });

    test("V8 counts the code after an await in a side that did not run as never run, so it is not provable", async () => {
        const text = [
            "export async function ask(a: boolean, b: string) {",
            "    const c = a ? await Promise.resolve(b) : await Promise.resolve(b);",
            "    const d = c + \"\";",
            "    if (d === \"stop\") {",
            "        return 1;",
            "    }",
            "    return 2;",
            "}",
            "",
        ].join("\n");
        const session = new Session();
        session.connect();
        try {
            await startCoverage(session);
            const ran = runFile("file:///virtual/await-in-a-side.ts", text);
            await takeCoverage(session);
            const ask = exportedFunction(ran, "ask");
            assert.equal(await ask(true, "go"), 2);
            assert.equal(await ask(true, "stop"), 1);
            const scripts = await takeCoverage(session);
            const script = scripts.find((one) => one.url === ran.measured.url);
            assert.ok(script !== undefined);
            const loaded = transpile("/virtual/await-in-a-side.ts", text, {
                target: ts.ScriptTarget.ES2022,
            }, "commonjs");
            const map = inlineMapOf(loaded);
            assert.ok(map !== undefined);
            const condition = new Places(map, loaded).generatedOffsetOf(4, 4);
            assert.ok(condition !== undefined);
            //
            // The condition ran twice, once for each call, and V8 says it never ran.
            //
            assert.equal(countAt(script, condition), 0);
            assert.deepEqual(ran.measured.notProvable.map((one) => one.name), ["if:4:false"]);
            const exercised = exercisedPaths(scripts, ran.measured).map((one) => one.name);
            assert.ok(exercised.includes("if:4:true"));
            assert.ok(exercised.includes("ternary:2:true"));
        }
        finally {
            session.disconnect();
        }
    });

    test("a function never called and the top level after it ran exercise nothing", async () => {
        const session = new Session();
        session.connect();
        try {
            await startCoverage(session);
            const ran = runFile("file:///virtual/two.ts", "export function first() { return 1; }\nexport function second() { return 2; }\n");
            assert.deepEqual(await exercisedNames(session, ran.measured), ["(top level):entered"]);
            exportedFunction(ran, "second")();
            assert.deepEqual(await exercisedNames(session, ran.measured), ["second:entered"]);
        }
        finally {
            session.disconnect();
        }
    });
});

//
// One code path, written out in the test, at `at` and counted against `against` when that is given.
//
export function site(name: string, at: [number, number], against: [number, number] | undefined): PathSite {
    return {
        name,
        describe: name,
        file: "a.ts",
        line: at[0],
        fn: "f",
        at: {
            line: at[0],
            column: at[1],
        },
        against: against === undefined
            ? undefined
            : {
                line: against[0],
                column: against[1],
            },
    };
}

//
// A file that ran, ten characters on one line, carrying a map that sends line 1 column 0 of the
// source to offset 0 and line 2 column 0 to offset 4, and nothing else anywhere.
//
const mapped = `0123456789\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(sourceMapOf(["a.ts"], "AAAA,IACA")).toString("base64")}\n`;

//
// The code paths `own`, at line 2 of the source, and `side`, at line 1 counted against line 2,
// which `mapped` finds at offsets 4 and 0.
//
const ownAndSide: Paths = {
    paths: [site("own", [2, 0], undefined), site("side", [1, 0], [2, 0])],
    notProvable: [],
};

describe("measureFile", () => {
    test("a path whose place is in the map is found at its offset in the file that ran", () => {
        const measured = measureFile("file:///a.ts", mapped, ownAndSide);
        assert.equal(measured.url, "file:///a.ts");
        assert.deepEqual(measured.paths.map((measuredPath) => [measuredPath.path.name, measuredPath.offset, measuredPath.againstOffset]), [["own", 4, undefined], ["side", 0, 4]]);
        assert.deepEqual(measured.notProvable, []);
    });

    test("a path whose place or whose other place the transpile left nowhere is not provable, with the paths V8 never counts", () => {
        const never = {
            name: "logic:1:&&:short",
            file: "a.ts",
            line: 1,
            fn: "f",
            describe: "the short circuit of `&&`",
        };
        const measured = measureFile("file:///a.ts", mapped, {
            paths: [site("lost", [9, 0], undefined), site("other lost", [1, 0], [9, 0])],
            notProvable: [never],
        });
        assert.deepEqual(measured.paths, []);
        assert.deepEqual(measured.notProvable.map((notProvable) => notProvable.name), ["logic:1:&&:short", "lost", "other lost"]);
    });

    test("a loaded file with no source map is a mistake in the loader", () => {
        assert.throws(() => measureFile("file:///a.ts", "first\n", {
            paths: [],
            notProvable: [],
        }), assert.AssertionError);
    });
});

describe("exercisedPaths", () => {
    const measured = measureFile("file:///a.ts", mapped, ownAndSide);

    test("a place that ran exercises its path, and a place that ran more often than its other place exercises its side", () => {
        assert.deepEqual(exercisedPaths([script("file:///a.ts", [[0, 10, 3], [4, 6, 1]])], measured).map((exercised) => exercised.name), ["own", "side"]);
    });

    test("a place that ran no more often than its other place leaves its side unexercised", () => {
        assert.deepEqual(exercisedPaths([script("file:///a.ts", [[0, 10, 2]])], measured).map((exercised) => exercised.name), ["own"]);
    });

    test("a place that did not run exercises nothing", () => {
        assert.deepEqual(exercisedPaths([script("file:///a.ts", [[0, 10, 0]])], measured), []);
    });

    test("a file the reading holds nothing for exercised nothing", () => {
        assert.deepEqual(exercisedPaths([script("file:///b.ts", [[0, 10, 5]])], measured), []);
    });
});
