//
// Checks the kept results: where an entry is kept, writing and reading one back (and refusing text
// of another format or version), reading and writing entry files, throwing every result away while
// the kept crashes stay, the imports a key follows, the files a shard's key covers that no file
// imports, keys that change exactly when a file that went into them changes, the salt, the
// contributors of each shard and which shards run again. Files are read and written in a file
// system in memory, which is also made to fail.
//

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "@jest/globals";
import { createFakeFileSystem, type IFakeFileSystem } from "../lib/fake-files.test.ts";
import { createLoader } from "../load/hooks.ts";
import type { IShardResult } from "./explore.ts";
import { pathKey } from "./measure.ts";
import { augmentingInProject, createKeyMemo, clearResults, contributorsOf, entryPath, formatVersion, importsOf, readKeyFile, workOutKeyFile, isEntryLaidOut, isObject, isStoredEntry, isUsable, keyOf, keyOfShard, markContributors, projectKeyInputs, readEntry, readEntryFile, resultsDirectoryOf, saltOf, unitsToRun, writeEntry, writeEntryFile, type ICacheEntry, type IKeyInputs, type IUnit } from "./results-cache.ts";

//
// The root of every project in memory these tests build. Any absolute path does, because the file
// system in memory holds nothing else.
//
const root = "/project";

//
// The result of a shard of `file` whose calls exercised `exercised`.
//
export function resultOf(file: string, exercised: string[]): IShardResult {
    return {
        facts: {
            file,
            functions: [],
            scenarios: [],
            paths: [],
            notProvable: [],
            uncallable: [],
            simProblems: [],
            loadProblem: undefined,
        },
        tallies: [{
            name: "f",
            line: 1,
            calls: 3,
            cutShort: false,
        }],
        exercised,
        failures: [],
        failedCalls: [],
    };
}

//
// A stored result of `file` with `key` and `contributors`.
//
export function entryOf(file: string, key: string, contributors: [string, string][]): ICacheEntry {
    return {
        file,
        key,
        contributors: contributors.map(([contributorFile, contributorKey]) => ({
            file: contributorFile,
            key: contributorKey,
        })),
        result: resultOf(file, []),
        replays: [],
    };
}

//
// `value` as JSON gives it back. A child's replies reach the run as JSON, so a field that is
// undefined is already left out of every result before it is stored, and a stored result is read
// back the same way.
//
export function asJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

//
// A file system in memory holding a project at `root` made of `files`, by path from the root.
//
export function projectOf(files: Record<string, string>): IFakeFileSystem {
    const written: Record<string, string> = {};
    for (const [name, text] of Object.entries(files)) {
        written[path.join(root, name)] = text;
    }
    return createFakeFileSystem(written);
}

//
// Changes the text of one file of the project in `files`, by its path from the root.
//
export function changeFile(files: IFakeFileSystem, name: string, text: string): void {
    files.files.set(path.join(root, name), text);
}

//
// Key inputs for the project in `files` at `root`: a relative import names a file beside the
// importer, with `.ts` added when it names no extension, and anything else is a package.
//
export function inputsOf(files: IFakeFileSystem, salt: string): IKeyInputs {
    return {
        projectRoot: root,
        files,
        async resolve(specifier: string, importer: string): Promise<string | undefined> {
            if (!specifier.startsWith(".")) {
                return undefined;
            }
            const resolved = path.resolve(path.dirname(importer), specifier);
            return path.extname(resolved) === "" ? `${resolved}.ts` : resolved;
        },
        async augmenting(): Promise<string[]> {
            return [];
        },
        salt,
        memo: createKeyMemo(),
    };
}

//
// What a run knows about the shard of `file`: its key in this run and its stored result.
//
export function unitOf(file: string, key: string, entry: ICacheEntry | undefined): IUnit {
    return {
        file,
        key,
        entry,
    };
}

describe("resultsDirectoryOf", () => {
    test("the results sit in their own directory of Faultline's cache directory", () => {
        assert.equal(resultsDirectoryOf("/project"), "/project/node_modules/.cache/faultline/results");
    });
});

describe("entryPath", () => {
    test("each file has a name of its own, the same every time", () => {
        const first = entryPath("/cache", "src/a.ts");
        assert.equal(first, entryPath("/cache", "src/a.ts"));
        assert.notEqual(first, entryPath("/cache", "src/b.ts"));
        assert.match(path.basename(first), /^[0-9a-f]{32}\.json$/);
        assert.equal(path.dirname(first), "/cache");
    });
});

describe("writeEntry", () => {
    test("an entry is written as one line of JSON that names the format and its version", () => {
        const entry = entryOf("src/a.ts", "k1", [["src/a.ts", "k1"], ["src/a.sim.ts", "k2"]]);
        const text = writeEntry(entry);
        assert(text.endsWith("}\n"));
        assert.deepEqual(JSON.parse(text), {
            format: "faultline-results",
            version: formatVersion,
            entry: asJson(entry),
        });
    });

    test("an entry keeps the answers of its replays and reads back with them", () => {
        const entry: ICacheEntry = {
            ...entryOf("src/a.ts", "k1", []),
            replays: [{
                token: "src/a.ts:f;seed=7;values=b1",
                failures: [],
                arguments: ["1"],
            }],
        };
        assert.deepEqual(readEntry(writeEntry(entry)), asJson(entry));
    });

    test("an entry whose result is of another file, or that has no key, is refused", () => {
        assert.throws(() => writeEntry({
            ...entryOf("src/a.ts", "k1", []),
            result: resultOf("src/b.ts", []),
        }));
        assert.throws(() => writeEntry(entryOf("src/a.ts", "", [])));
    });
});

describe("readEntry", () => {
    test("an entry is read back as it was written", () => {
        const entry = entryOf("src/a.ts", "k1", [["src/a.ts", "k1"], ["src/a.sim.ts", "k2"]]);
        assert.deepEqual(readEntry(writeEntry(entry)), asJson(entry));
    });

    test("text that is not a stored result of this version is no entry", () => {
        const entry = entryOf("src/a.ts", "k1", []);
        assert.equal(readEntry("not json"), undefined);
        assert.equal(readEntry(JSON.stringify({
            format: "other",
            version: formatVersion,
            entry,
        })), undefined);
        assert.equal(readEntry(JSON.stringify({
            format: "faultline-results",
            version: formatVersion + 1,
            entry,
        })), undefined);
        assert.equal(readEntry("null"), undefined);
    });
});

describe("isStoredEntry", () => {
    test("a stored entry laid out the way it is written is one", () => {
        const entry = entryOf("src/a.ts", "k1", []);
        assert.equal(isStoredEntry({
            format: "faultline-results",
            version: 1,
            entry,
        }), true);
        assert.equal(isStoredEntry(7), false);
    });

    test("a stored entry with a part missing or of the wrong type is not taken for one", () => {
        const entry = entryOf("src/a.ts", "k1", []);
        assert.equal(isStoredEntry({
            version: 1,
            entry,
        }), false);
        assert.equal(isStoredEntry({
            format: 1,
            version: 1,
            entry,
        }), false);
        assert.equal(isStoredEntry({
            format: "f",
            entry,
        }), false);
        assert.equal(isStoredEntry({
            format: "f",
            version: "1",
            entry,
        }), false);
        assert.equal(isStoredEntry({
            format: "f",
            version: 1,
        }), false);
        assert.equal(isStoredEntry({
            format: "f",
            version: 1,
            entry: null,
        }), false);
    });
});

describe("isEntryLaidOut", () => {
    test("an entry that names its file and key and holds contributors, a result and replays is laid out", () => {
        assert.equal(isEntryLaidOut(entryOf("src/a.ts", "k1", [])), true);
        assert.equal(isEntryLaidOut(null), false);
        assert.equal(isEntryLaidOut("entry"), false);
    });

    test("an entry with a part missing or of the wrong type is not laid out", () => {
        const entry = entryOf("src/a.ts", "k1", []);
        assert.equal(isEntryLaidOut({
            key: entry.key,
            contributors: entry.contributors,
            result: entry.result,
        }), false);
        assert.equal(isEntryLaidOut({
            ...entry,
            file: 1,
        }), false);
        assert.equal(isEntryLaidOut({
            file: entry.file,
            contributors: entry.contributors,
            result: entry.result,
        }), false);
        assert.equal(isEntryLaidOut({
            ...entry,
            key: 1,
        }), false);
        assert.equal(isEntryLaidOut({
            file: entry.file,
            key: entry.key,
            result: entry.result,
        }), false);
        assert.equal(isEntryLaidOut({
            ...entry,
            contributors: {},
        }), false);
        assert.equal(isEntryLaidOut({
            file: entry.file,
            key: entry.key,
            contributors: entry.contributors,
        }), false);
        assert.equal(isEntryLaidOut({
            ...entry,
            result: null,
        }), false);
        assert.equal(isEntryLaidOut({
            ...entry,
            result: 3,
        }), false);
        assert.equal(isEntryLaidOut({
            file: entry.file,
            key: entry.key,
            contributors: entry.contributors,
            result: entry.result,
        }), false);
        assert.equal(isEntryLaidOut({
            ...entry,
            replays: {},
        }), false);
    });
});

describe("isObject", () => {
    test("an object or an array is an object, and null and every other value are not", () => {
        assert.equal(isObject({}), true);
        assert.equal(isObject([]), true);
        assert.equal(isObject(null), false);
        assert.equal(isObject(undefined), false);
        assert.equal(isObject("text"), false);
        assert.equal(isObject(3), false);
    });
});

describe("readEntryFile", () => {
    test("no file, a file that is not an entry and an entry of another file are no entry", async () => {
        const directory = "/project/entries/other";
        const files = createFakeFileSystem({
            [entryPath(directory, "src/bad.ts")]: "garbage",
            [entryPath(directory, "src/moved.ts")]: writeEntry(entryOf("src/elsewhere.ts", "k", [])),
        });
        assert.equal(await readEntryFile(files, directory, "src/none.ts"), undefined);
        assert.equal(await readEntryFile(files, directory, "src/bad.ts"), undefined);
        assert.equal(await readEntryFile(files, directory, "src/moved.ts"), undefined);
    });

    test("a stored result that is there and cannot be read rejects with the error, and is read once it can be", async () => {
        const directory = "/project/entries/other";
        const files = createFakeFileSystem({
            [entryPath(directory, "src/locked.ts")]: writeEntry(entryOf("src/locked.ts", "k", [])),
        });
        files.failNext(entryPath(directory, "src/locked.ts"), "EACCES");
        await assert.rejects(readEntryFile(files, directory, "src/locked.ts"), /EACCES/);
        assert.deepEqual(await readEntryFile(files, directory, "src/locked.ts"), asJson(entryOf("src/locked.ts", "k", [])));
    });
});

describe("writeEntryFile", () => {
    test("an entry written is read back, and the directory is made", async () => {
        const files = createFakeFileSystem({});
        const directory = "/project/entries/deep";
        const entry = entryOf("src/a.ts", "k1", [["src/a.ts", "k1"]]);
        await writeEntryFile(files, directory, entry);
        assert.equal(files.directories.has(directory), true);
        assert.deepEqual(await readEntryFile(files, directory, "src/a.ts"), asJson(entry));
    });

    test("a directory that cannot be made rejects before anything is written", async () => {
        const files = createFakeFileSystem({});
        const directory = "/project/entries/deep";
        files.failNext(directory, "EACCES");
        await assert.rejects(writeEntryFile(files, directory, entryOf("src/a.ts", "k1", [])), /EACCES/);
        assert.equal(files.files.size, 0);
    });
});

describe("clearResults", () => {
    test("clearing throws every result away and leaves the kept crashes", async () => {
        const files = projectOf({
            "node_modules/.cache/faultline/crashes.txt": "src/a.ts:f;seed=1\n",
        });
        await writeEntryFile(files, resultsDirectoryOf(root), entryOf("src/a.ts", "k", []));
        await clearResults(files, root);
        assert.equal(await files.isDirectory(resultsDirectoryOf(root)), false);
        assert.equal(files.files.get(path.join(root, "node_modules/.cache/faultline/crashes.txt")), "src/a.ts:f;seed=1\n");
        await clearResults(files, root);
        assert.equal(await files.isDirectory(resultsDirectoryOf(root)), false);
    });
});

describe("importsOf", () => {
    test("imports, exports from, requires and dynamic imports are all followed, in the order written", () => {
        const text = [
            "import { a } from \"./a.ts\";",
            "export { b } from \"./b\";",
            "const c = require(\"./c.js\");",
            "const d = await import(\"pkg\");",
            "import type { E } from \"./e.ts\";",
        ].join("\n");
        assert.deepEqual(importsOf(text), ["./a.ts", "./b", "./c.js", "pkg", "./e.ts"]);
        assert.deepEqual(importsOf("const one = 1;"), []);
    });
});

describe("keyOf", () => {
    test("the key follows imports at any depth and changes only when a file that went into it changes", async () => {
        const files = projectOf({
            "src/a.ts": "import { b } from \"./b\";\nimport pkg from \"pkg\";\nexport const a = b;\n",
            "src/b.ts": "import data from \"./data.json\";\nimport { a } from \"./a.ts\";\nexport const b = data;\n",
            "src/data.json": "{ \"v\": 1 }\n",
            "src/other.ts": "export const other = 1;\n",
        });
                const first = await keyOf(inputsOf(files, "salt"), ["src/a.ts"]);
        assert.match(first, /^[0-9a-f]{64}$/);
        assert.equal(await keyOf(inputsOf(files, "salt"), ["src/a.ts", "src/a.ts"]), first);
        changeFile(files, "src/other.ts", "export const other = 2;\n");
        assert.equal(await keyOf(inputsOf(files, "salt"), ["src/a.ts"]), first);
        changeFile(files, "src/data.json", "{ \"v\": 2 }\n");
        const changed = await keyOf(inputsOf(files, "salt"), ["src/a.ts"]);
        assert.notEqual(changed, first);
        assert.notEqual(await keyOf(inputsOf(files, "other salt"), ["src/a.ts"]), changed);
        assert.notEqual(await keyOf(inputsOf(files, "salt"), ["src/a.ts", "src/other.ts"]), changed);
    });

    test("a file that is missing changes the key when it comes back", async () => {
        const files = projectOf({
            "src/a.ts": "import { gone } from \"./gone\";\n",
        });
                const missing = await keyOf(inputsOf(files, "salt"), ["src/a.ts"]);
        changeFile(files, "src/gone.ts", "export const gone = 1;\n");
        assert.notEqual(await keyOf(inputsOf(files, "salt"), ["src/a.ts"]), missing);
    });

    test("one run's inputs read, scan and resolve each file once, however many keys take it", async () => {
        const files = projectOf({
            "src/a.ts": "import { b } from \"./b\";\nexport const a = b;\n",
            "src/b.ts": "export const b = 1;\n",
        });
        const inputs = inputsOf(files, "salt");
        const first = await keyOf(inputs, ["src/a.ts"]);
        assert.equal(inputs.memo.files.size, 2);
        assert.deepEqual(await inputs.memo.files.get("src/a.ts"), {
            text: "import { b } from \"./b\";\nexport const a = b;\n",
            imports: ["src/b.ts"],
        });
        changeFile(files, "src/b.ts", "export const b = 2;\n");
        assert.equal(await keyOf(inputs, ["src/a.ts"]), first);
        assert.notEqual(await keyOf(inputsOf(files, "salt"), ["src/a.ts"]), first);
    });

    test("a file that is there and cannot be read rejects with the error", async () => {
        const files = projectOf({
            "src/a.ts": "export const a = 1;\n",
        });
        files.failNext(path.join(root, "src/a.ts"), "EACCES");
        await assert.rejects(keyOf(inputsOf(files, "salt"), ["src/a.ts"]), /EACCES/);
        assert.match(await keyOf(inputsOf(files, "salt"), ["src/a.ts"]), /^[0-9a-f]{64}$/);
    });
});

describe("createKeyMemo", () => {
    test("a run starts with nothing worked out", () => {
        const memo = createKeyMemo();
        assert.equal(memo.files.size, 0);
        assert.equal(memo.owners.size, 0);
        assert.equal(memo.augmenting.size, 0);
    });
});

describe("readKeyFile and workOutKeyFile", () => {
    test("a script's text and the project files it imports, a missing file and a file that imports nothing", async () => {
        const files = projectOf({
            "src/a.ts": "import { b } from \"./b\";\nimport pkg from \"pkg\";\n",
            "src/data.json": "{ \"import\": \"./b\" }\n",
        });
        const inputs = inputsOf(files, "salt");
        assert.deepEqual(await workOutKeyFile(inputs, "src/a.ts"), {
            text: "import { b } from \"./b\";\nimport pkg from \"pkg\";\n",
            imports: ["src/b.ts"],
        });
        assert.deepEqual(await workOutKeyFile(inputs, "src/gone.ts"), {
            text: undefined,
            imports: [],
        });
        assert.deepEqual((await workOutKeyFile(inputs, "src/data.json")).imports, []);
    });

    test("the same file asked for twice in one run is worked out once", async () => {
        const inputs = inputsOf(projectOf({
            "src/a.ts": "export const a = 1;\n",
        }), "salt");
        const first = readKeyFile(inputs, "src/a.ts");
        assert.equal(readKeyFile(inputs, "src/a.ts"), first);
        assert.throws(() => readKeyFile(inputs, path.join(root, "src/a.ts")), assert.AssertionError);
    });
});

describe("keyOfShard", () => {
    test("a shard's key covers its file and its sim files", async () => {
        const files = projectOf({
            "src/a.ts": "export const a = 1;\n",
            "src/a.sim.ts": "export function make(): number { return 1; }\n",
            "global.sim.ts": "export function other(): number { return 2; }\n",
        });
                const shard = {
            file: "src/a.ts",
            sims: ["src/a.sim.ts", "global.sim.ts"],
        };
        const first = await keyOfShard(inputsOf(files, "salt"), shard);
        assert.equal(first, await keyOf(inputsOf(files, "salt"), ["src/a.ts", "src/a.sim.ts", "global.sim.ts"]));
        changeFile(files, "global.sim.ts", "export function other(): number { return 3; }\n");
        assert.notEqual(await keyOfShard(inputsOf(files, "salt"), shard), first);
    });

    //
    // Goal: a shard's program holds every file under its `tsconfig.json` that declares something for
    // every file, imported or not, so the shard's result depends on them. Method: a project whose
    // `declare global` file no file imports, with keys worked out the way a run works them out,
    // and a change to only that file between two keys.
    //
    test("a shard's key covers a file under its tsconfig.json that declares something for every file, which no file imports", async () => {
        const files = projectOf({
            "tsconfig.json": "{ \"compilerOptions\": { \"strict\": true } }\n",
            "src/a.ts": "export const a = 1;\n",
            "src/types/globals.d.ts": "declare global { var first: number; }\nexport {};\n",
            "src/plain.d.ts": "export type Plain = number;\n",
        });
        const settings = {
            projectRoot: root,
            toolModules: "/faultline/src",
        };
        const shard = {
            file: "src/a.ts",
            sims: [],
        };
        const first = await keyOfShard(projectKeyInputs(files, settings, "salt"), shard);
        assert.equal(await keyOfShard(projectKeyInputs(files, settings, "salt"), shard), first);
        changeFile(files, "src/plain.d.ts", "export type Plain = string;\n");
        assert.equal(await keyOfShard(projectKeyInputs(files, settings, "salt"), shard), first);
        changeFile(files, "src/types/globals.d.ts", "declare global { var second: string; }\nexport {};\n");
        assert.notEqual(await keyOfShard(projectKeyInputs(files, settings, "salt"), shard), first);
    });
});

describe("augmentingInProject", () => {
    //
    // Goal: the files found are the ones a shard's program adds, by path from the project root.
    // Method: a project with a `tsconfig.json`, one without, and a file of each kind.
    //
    test("the files under the owning tsconfig.json that declare something for every file, and none without one", async () => {
        const settings = {
            projectRoot: root,
            toolModules: "/faultline/src",
        };
        const owned = projectOf({
            "tsconfig.json": "{}\n",
            "src/a.ts": "export const a = 1;\n",
            "src/types/globals.d.ts": "declare global { var first: number; }\nexport {};\n",
            "src/express.d.ts": "declare module \"express\" { interface Request { user: string; } }\n",
        });
        const memo = createKeyMemo();
        const found = await augmentingInProject(createLoader(settings, owned), "src/a.ts", memo);
        assert.deepEqual([...found].sort(), ["src/express.d.ts", "src/types/globals.d.ts"]);
        assert.equal(memo.owners.get(path.join(root, "src")) !== undefined, true);
        assert.deepEqual(await augmentingInProject(createLoader(settings, owned), "src/a.ts", memo), found);
        assert.equal(memo.augmenting.size, 1);
        const unowned = projectOf({
            "src/a.ts": "export const a = 1;\n",
            "src/types/globals.d.ts": "declare global { var first: number; }\nexport {};\n",
        });
        assert.deepEqual(await augmentingInProject(createLoader(settings, unowned), "src/a.ts", createKeyMemo()), []);
        await assert.rejects(augmentingInProject(createLoader(settings, owned), path.join(root, "src/a.ts"), createKeyMemo()), assert.AssertionError);
    });
});

describe("projectKeyInputs", () => {
    test("imports resolve through the project's tsconfig.json, and a key follows them", async () => {
        const files = projectOf({
            "tsconfig.json": "{ \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"lib/*\"] }, \"moduleResolution\": \"bundler\", \"module\": \"ESNext\" } }\n",
            "src/a.ts": "import { b } from \"@lib/b\";\nimport fs from \"node:fs\";\nexport const a = b;\n",
            "lib/b.ts": "export const b = 1;\n",
        });
        const inputs = projectKeyInputs(files, {
            projectRoot: root,
            toolModules: "/faultline/src",
        }, "salt");
        assert.equal(inputs.projectRoot, root);
        assert.equal(inputs.salt, "salt");
        assert.equal(await inputs.resolve("@lib/b", path.join(root, "src/a.ts")), path.join(root, "lib/b.ts"));
        assert.equal(await inputs.resolve("node:fs", path.join(root, "src/a.ts")), undefined);
        const first = await keyOf(inputs, ["src/a.ts"]);
        changeFile(files, "lib/b.ts", "export const b = 2;\n");
        assert.notEqual(await keyOf(projectKeyInputs(files, {
            projectRoot: root,
            toolModules: "/faultline/src",
        }, "salt"), ["src/a.ts"]), first);
    });
});

describe("saltOf", () => {
    test("the salt holds Faultline's version and the project's lockfile", async () => {
        const files = projectOf({
            "bun.lock": "first\n",
        });
        const first = await saltOf(files, root, "0.1.0");
        assert.match(first, /^faultline 0\.1\.0\0bun\.lock\0first\n\0bun\.lockb\0/);
        assert.notEqual(await saltOf(files, root, "0.2.0"), first);
        changeFile(files, "bun.lock", "second\n");
        assert.notEqual(await saltOf(files, root, "0.1.0"), first);
        assert.equal(await saltOf(files, root, "0.1.0"), await saltOf(files, root, "0.1.0"));
    });

    test("a lockfile that is there and cannot be read rejects with the error", async () => {
        const files = projectOf({
            "bun.lock": "first\n",
        });
        files.failNext(path.join(root, "bun.lock"), "EACCES");
        await assert.rejects(saltOf(files, root, "0.1.0"), /EACCES/);
        assert.match(await saltOf(files, root, "0.1.0"), /^faultline 0\.1\.0\0bun\.lock\0first\n/);
    });
});

describe("contributorsOf", () => {
    test("each shard is contributed to by itself and by every shard whose calls exercised its file", () => {
        const results = [
            resultOf("src/a.ts", [pathKey("src/a.ts", "f:entered"), pathKey("src/b.ts", "g:entered")]),
            resultOf("src/b.ts", []),
            resultOf("src/a.sim.ts", [pathKey("src/a.ts", "f:entered")]),
        ];
        const keys = new Map([["src/a.ts", "ka"], ["src/b.ts", "kb"], ["src/a.sim.ts", "ks"]]);
        const contributors = contributorsOf(results, keys);
        assert.deepEqual(contributors.get("src/a.ts"), [
            {
                file: "src/a.ts",
                key: "ka",
            },
            {
                file: "src/a.sim.ts",
                key: "ks",
            },
        ]);
        assert.deepEqual(contributors.get("src/b.ts"), [
            {
                file: "src/a.ts",
                key: "ka",
            },
            {
                file: "src/b.ts",
                key: "kb",
            },
        ]);
        assert.deepEqual(contributors.get("src/a.sim.ts"), [
            {
                file: "src/a.sim.ts",
                key: "ks",
            },
        ]);
    });

    test("a shard with no key is a defect in the run", () => {
        assert.throws(() => contributorsOf([resultOf("src/a.ts", [])], new Map()));
    });
});

describe("unitsToRun", () => {
    test("a unit whose result and contributors are unchanged is loaded, and any other runs", () => {
        const units: IUnit[] = [
            unitOf("src/a.ts", "ka", entryOf("src/a.ts", "ka", [["src/a.ts", "ka"]])),
            unitOf("src/b.ts", "kb", undefined),
            unitOf("src/c.ts", "kc2", entryOf("src/c.ts", "kc", [["src/c.ts", "kc"]])),
        ];
        assert.deepEqual(unitsToRun(units), [false, true, true]);
        assert.deepEqual(unitsToRun([]), []);
    });

    test("a contributor that changed or is gone makes the unit run, and so does every contributor of a unit that runs", () => {
        const units: IUnit[] = [
            unitOf("src/a.ts", "ka", entryOf("src/a.ts", "ka", [["src/a.ts", "ka"], ["src/a.sim.ts", "ks-old"]])),
            unitOf("src/a.sim.ts", "ks", entryOf("src/a.sim.ts", "ks", [["src/a.sim.ts", "ks"]])),
            unitOf("src/b.ts", "kb", entryOf("src/b.ts", "kb", [["src/b.ts", "kb"], ["src/gone.ts", "kg"]])),
            unitOf("src/c.ts", "kc", entryOf("src/c.ts", "kc", [["src/c.ts", "kc"]])),
            unitOf("src/d.ts", "kd", entryOf("src/d.ts", "kd-old", [["src/d.ts", "kd"], ["src/c.ts", "kc"]])),
        ];
        assert.deepEqual(unitsToRun(units), [true, true, true, true, true]);
    });

    test("a chain of contributors is followed to its end", () => {
        const units: IUnit[] = [
            unitOf("src/a.ts", "ka", entryOf("src/a.ts", "ka", [["src/a.ts", "ka"], ["src/b.ts", "kb"]])),
            unitOf("src/b.ts", "kb", entryOf("src/b.ts", "kb", [["src/b.ts", "kb"], ["src/c.ts", "kc"]])),
            unitOf("src/c.ts", "kc", entryOf("src/c.ts", "kc", [["src/c.ts", "kc"]])),
            unitOf("src/d.ts", "kd", entryOf("src/d.ts", "kd", [["src/d.ts", "kd"], ["src/a.ts", "ka"]])),
            unitOf("src/e.ts", "ke", entryOf("src/e.ts", "ke", [["src/e.ts", "ke"]])),
        ];
        units[3] = unitOf("src/d.ts", "kd-new", units[3]?.entry);
        assert.deepEqual(unitsToRun(units), [true, true, true, true, false]);
    });
});

describe("markContributors", () => {
    test("the contributors of a unit to run are marked, and the answer says whether one was new", () => {
        const units: IUnit[] = [
            unitOf("src/a.ts", "ka", entryOf("src/a.ts", "ka", [["src/a.ts", "ka"], ["src/b.ts", "kb"], ["src/gone.ts", "kg"]])),
            unitOf("src/b.ts", "kb", undefined),
        ];
        const positions = new Map([["src/a.ts", 0], ["src/b.ts", 1]]);
        const toRun = [true, false];
        assert.equal(markContributors(units, positions, toRun), true);
        assert.deepEqual(toRun, [true, true]);
        assert.equal(markContributors(units, positions, toRun), false);
        assert.deepEqual(toRun, [true, true]);
    });

    test("a unit not marked to run marks none of its contributors", () => {
        const units: IUnit[] = [
            unitOf("src/a.ts", "ka", entryOf("src/a.ts", "ka", [["src/b.ts", "kb"]])),
            unitOf("src/b.ts", "kb", undefined),
        ];
        const toRun = [false, false];
        assert.equal(markContributors(units, new Map([["src/a.ts", 0], ["src/b.ts", 1]]), toRun), false);
        assert.deepEqual(toRun, [false, false]);
    });
});

describe("isUsable", () => {
    test("an entry stored under another file's name is not used, and one that matches is", () => {
        const moved = unitOf("src/a.ts", "k", entryOf("src/b.ts", "k", []));
        assert.equal(isUsable([moved], new Map([["src/a.ts", 0]]), moved), false);
        const kept = unitOf("src/a.ts", "k", entryOf("src/a.ts", "k", [["src/a.ts", "k"]]));
        assert.equal(isUsable([kept], new Map([["src/a.ts", 0]]), kept), true);
    });

    test("a unit that is not among the units is a defect in the run", () => {
        const unit = unitOf("src/a.ts", "k", undefined);
        assert.throws(() => isUsable([unit], new Map([["src/b.ts", 0]]), unit));
    });
});
