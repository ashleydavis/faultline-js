//
// Checks the compile cache. Goal: an entry is used only when everything it was worked out from is
// unchanged (the shard's file, its sim files, every project file they import, the compiler options,
// the lockfile and Faultline's own code), a hit gives back exactly what was kept, and an entry that
// was written under another key, by another format, cut short or garbled is a miss. Method: a
// project and Faultline's code held in a file system in memory, a stand-in reader that counts what
// it is asked to work out, and edits to one input at a time between two readers over the same
// files, as two runs would be.
//

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { types } from "node:util";
import { describe, test } from "@jest/globals";
import type { MeasuredFile } from "../coverage/v8.ts";
import { createFakeFileSystem, type IFakeFileSystem } from "../lib/fake-files.test.ts";
import { createLoader } from "../load/hooks.ts";
import { CachedShardReader, compileCacheDirectory, compileEntryFormat, compileEntryName, hashParts, hashText, hashToolCode, readCompileEntry, toolEntriesMost, writeCompileEntry } from "./compile-cache.ts";
import type { IShardReader } from "./shard-reader.ts";
import type { IShardReading } from "./shard.ts";

//
// The project root and the directory of Faultline's own code these tests hold in memory.
//
const root = "/project";
const toolModules = "/faultline/dist";

//
// A stand-in reader that counts each value it is asked to work out and gives back one built from
// the request, so a test tells a value worked out now from one kept in the cache.
//
export class CountingReader implements IShardReader {
    //
    // How many reads were asked for.
    //
    reads: number;

    //
    // How many measures were asked for.
    //
    measures: number;

    //
    // Builds a reader that has been asked nothing.
    //
    constructor() {
        this.reads = 0;
        this.measures = 0;
    }

    //
    // A reading that names the shard and how many reads came before it.
    //
    read(file: string, sims: string[]): Promise<IShardReading> {
        this.reads += 1;
        return Promise.resolve(buildReading(`${file} ${sims.join(",")} ${this.reads}`));
    }

    //
    // A measurement of a project file, and nothing for any other URL.
    //
    measure(url: string): Promise<MeasuredFile | undefined> {
        this.measures += 1;
        if (url.includes("/node_modules/")) {
            return Promise.resolve(undefined);
        }
        return Promise.resolve(buildMeasured(url));
    }
}

//
// A shard reading whose conditions name `label`.
//
export function buildReading(label: string): IShardReading {
    return {
        facts: undefined,
        sims: [],
        conditions: new Map([[label, []]]),
        parseErrors: [],
    };
}

//
// A measurement of `url` with no code paths.
//
export function buildMeasured(url: string): MeasuredFile {
    return {
        url,
        paths: [],
        notProvable: [],
    };
}

//
// A project at `root` with a file that imports another, a sim file, a `tsconfig.json`, a
// `package.json`, a lockfile and Faultline's own code.
//
export function buildProject(): IFakeFileSystem {
    return createFakeFileSystem({
        [path.join(root, "tsconfig.json")]: "{ \"compilerOptions\": { \"strict\": true } }\n",
        [path.join(root, "package.json")]: "{ \"type\": \"module\" }\n",
        [path.join(root, "bun.lock")]: "lock 1\n",
        [path.join(root, "src/a.ts")]: "import { b } from \"./b.ts\";\nexport const a = b;\n",
        [path.join(root, "src/b.ts")]: "export const b = 1;\n",
        [path.join(root, "src/a.sim.ts")]: "export function make(): number { return 1; }\n",
        [path.join(root, "src/other.ts")]: "export const other = 1;\n",
        [path.join(root, "node_modules/pkg/index.js")]: "export const pkg = 1;\n",
        [path.join(toolModules, "main.js")]: "main 1\n",
        [path.join(toolModules, "run/child.js")]: "child 1\n",
    });
}

//
// A compile cache over `files` that works values out with `inner`, as one run's reader thread.
//
export function cacheOver(files: IFakeFileSystem, inner: IShardReader): CachedShardReader {
    const loader = createLoader({
        projectRoot: root,
        toolModules,
    }, files);
    return new CachedShardReader({
        inner,
        loader,
        files,
        directory: compileCacheDirectory(root),
    });
}

//
// Reads the shard `src/a.ts` with its sim file through a new cache over `files`, as a new run
// would, and says whether the stand-in had to work it out.
//
export async function isReadWorkedOut(files: IFakeFileSystem): Promise<boolean> {
    const inner = new CountingReader();
    await cacheOver(files, inner).read("src/a.ts", ["src/a.sim.ts"]);
    assert(inner.reads <= 1);
    return inner.reads === 1;
}

//
// Measures `src/a.ts` through a new cache over `files` and says whether the stand-in had to.
//
export async function isMeasureWorkedOut(files: IFakeFileSystem): Promise<boolean> {
    const inner = new CountingReader();
    await cacheOver(files, inner).measure(pathToFileURL(path.join(root, "src/a.ts")).href);
    assert(inner.measures <= 1);
    return inner.measures === 1;
}

//
// A reading or measurement written out as JSON, with a map as its entries, so two values compare
// by what they hold whichever JavaScript realm built them. Jest runs each test file in a realm of
// its own, and V8 builds what it deserializes in Node's.
//
export function describeValue(value: unknown): string {
    return JSON.stringify(value, (_key: string, held: unknown) => (types.isMap(held) ? [...held.entries()] : held));
}

describe("compileCacheDirectory", () => {
    test("the entries sit in Faultline's cache directory in the project, beside the kept results", () => {
        assert.equal(compileCacheDirectory(root), "/project/node_modules/.cache/faultline/compiled");
        assert.throws(() => compileCacheDirectory("project"), assert.AssertionError);
    });
});

describe("writeCompileEntry and readCompileEntry", () => {
    test("a value written under a key reads back the same under that key, maps included", () => {
        const value = buildReading("label");
        const text = writeCompileEntry("key", value);
        assert(text.startsWith(`${compileEntryFormat}\nkey\n`));
        assert.equal(describeValue(readCompileEntry(text, "key")), describeValue(value));
    });

    test("an entry written under another key, by another format, cut short or garbled is a miss", () => {
        const text = writeCompileEntry("key", buildReading("label"));
        assert.equal(readCompileEntry(text, "other"), undefined);
        assert.equal(readCompileEntry(text.replace(compileEntryFormat, "faultline-compiled 0"), "key"), undefined);
        assert.equal(readCompileEntry(text.slice(0, text.length - 10), "key"), undefined);
        assert.equal(readCompileEntry(text.slice(0, text.length - 1), "key"), undefined);
        assert.equal(readCompileEntry(`${compileEntryFormat}\nkey\nnot-what-v8-wrote\n`, "key"), undefined);
        assert.equal(readCompileEntry("", "key"), undefined);
        assert.equal(readCompileEntry(`${text.trimEnd()}\nmore`, "key"), undefined);
        assert.equal(readCompileEntry(`${compileEntryFormat}\nkey\nAAAA\ntrailing`, "key"), undefined);
    });

    test("a key that is empty or runs over a line is a defect in the caller", () => {
        assert.throws(() => writeCompileEntry("", 1), assert.AssertionError);
        assert.throws(() => writeCompileEntry("a\nb", 1), assert.AssertionError);
        assert.throws(() => readCompileEntry("text", ""), assert.AssertionError);
    });
});

describe("compileEntryName", () => {
    test("each kind and name has an entry file of its own, the same every time", () => {
        assert.equal(compileEntryName("read", "src/a.ts"), compileEntryName("read", "src/a.ts"));
        assert.notEqual(compileEntryName("read", "src/a.ts"), compileEntryName("measure", "src/a.ts"));
        assert.notEqual(compileEntryName("read", "src/a.ts"), compileEntryName("read", "src/b.ts"));
        assert.match(compileEntryName("read", "src/a.ts"), /^read-[0-9a-f]{64}\.txt$/);
        assert.throws(() => compileEntryName("read", ""), assert.AssertionError);
    });
});

describe("hashToolCode", () => {
    test("the hash changes when a file of Faultline's code changes, is added or is renamed", async () => {
        const files = buildProject();
        const first = await hashToolCode(files, toolModules);
        assert.match(first, /^[0-9a-f]{64}$/);
        assert.equal(await hashToolCode(files, toolModules), first);
        files.files.set(path.join(toolModules, "run/child.js"), "child 2\n");
        const changed = await hashToolCode(files, toolModules);
        assert.notEqual(changed, first);
        files.files.set(path.join(toolModules, "run/more.js"), "more\n");
        const added = await hashToolCode(files, toolModules);
        assert.notEqual(added, changed);
        files.files.delete(path.join(toolModules, "run/more.js"));
        files.files.set(path.join(toolModules, "run/renamed.js"), "more\n");
        assert.notEqual(await hashToolCode(files, toolModules), added);
    });

    test("the hash is the same whatever order the directory lists its files in", async () => {
        const forwards = createFakeFileSystem({
            [path.join(toolModules, "a.js")]: "a\n",
            [path.join(toolModules, "z.js")]: "z\n",
        });
        const backwards = createFakeFileSystem({
            [path.join(toolModules, "z.js")]: "z\n",
            [path.join(toolModules, "a.js")]: "a\n",
        });
        assert.equal(await hashToolCode(forwards, toolModules), await hashToolCode(backwards, toolModules));
    });

    test("a relative directory is a defect in the caller, and the walk has a limit", async () => {
        await assert.rejects(hashToolCode(buildProject(), "dist"), assert.AssertionError);
        assert(toolEntriesMost > 1000);
    });
});

describe("hashParts and hashText", () => {
    test("the same parts hash the same, and parts split another way hash differently", () => {
        assert.equal(hashParts(["ab", "c"]), hashParts(["ab", "c"]));
        assert.notEqual(hashParts(["ab", "c"]), hashParts(["a", "bc"]));
        assert.notEqual(hashParts(["a"]), hashParts(["a", ""]));
        assert.throws(() => hashParts([]), assert.AssertionError);
    });

    test("text that holds the separator hashes to a part that holds none", () => {
        assert.match(hashText("a\0b"), /^[0-9a-f]{64}$/);
        assert.notEqual(hashText("a\0b"), hashText("a\0c"));
        assert.equal(hashText(""), hashText(""));
    });
});

describe("CachedShardReader.read", () => {
    test("a shard is worked out once and every later read, by a later reader too, gives back what was kept", async () => {
        const files = buildProject();
        const inner = new CountingReader();
        const cache = cacheOver(files, inner);
        const first = await cache.read("src/a.ts", ["src/a.sim.ts"]);
        assert.equal(inner.reads, 1);
        assert.equal(describeValue(await cache.read("src/a.ts", ["src/a.sim.ts"])), describeValue(first));
        assert.equal(inner.reads, 1);
        const later = new CountingReader();
        assert.equal(describeValue(await cacheOver(files, later).read("src/a.ts", ["src/a.sim.ts"])), describeValue(first));
        assert.equal(later.reads, 0);
        const left = [...files.files.keys()].filter((file) => file.endsWith(".tmp"));
        assert.deepEqual(left, []);
    });

    test("a file that is not imported leaves the entry in use", async () => {
        const files = buildProject();
        assert.equal(await isReadWorkedOut(files), true);
        files.files.set(path.join(root, "src/other.ts"), "export const other = 2;\n");
        assert.equal(await isReadWorkedOut(files), false);
    });

    test("a change to the file, a file it imports, its sim file, its tsconfig, the lockfile or Faultline's code works it out again", async () => {
        const changes: [string, string][] = [
            ["src/a.ts", "import { b } from \"./b.ts\";\nexport const a = b + 1;\n"],
            ["src/b.ts", "export const b = 2;\n"],
            ["src/a.sim.ts", "export function make(): number { return 2; }\n"],
            ["tsconfig.json", "{ \"compilerOptions\": { \"strict\": false } }\n"],
            ["bun.lock", "lock 2\n"],
            [path.join(toolModules, "main.js"), "main 2\n"],
        ];
        for (const [file, text] of changes) {
            const files = buildProject();
            assert.equal(await isReadWorkedOut(files), true);
            assert.equal(await isReadWorkedOut(files), false);
            files.files.set(path.isAbsolute(file) ? file : path.join(root, file), text);
            assert.equal(await isReadWorkedOut(files), true, `A change to ${file} did not work the shard out again.`);
        }
    });

    //
    // Goal: a shard's program holds every file under its `tsconfig.json` that declares something for
    // every file, imported or not, so its reading depends on them. Method: add such a file that no
    // file imports, read the shard twice, change only that file and read it again.
    //
    test("a change to a file that declares something for every file, which no file imports, works it out again", async () => {
        const files = buildProject();
        files.files.set(path.join(root, "src/types/globals.d.ts"), "declare global { var first: number; }\nexport {};\n");
        assert.equal(await isReadWorkedOut(files), true);
        assert.equal(await isReadWorkedOut(files), false);
        files.files.set(path.join(root, "src/types/globals.d.ts"), "declare global { var second: string; }\nexport {};\n");
        assert.equal(await isReadWorkedOut(files), true);
    });

    test("a different set of sim files is a different entry", async () => {
        const files = buildProject();
        const inner = new CountingReader();
        const cache = cacheOver(files, inner);
        await cache.read("src/a.ts", ["src/a.sim.ts"]);
        await cache.read("src/a.ts", []);
        assert.equal(inner.reads, 2);
    });

    test("a garbled entry is a miss, worked out again and written over", async () => {
        const files = buildProject();
        assert.equal(await isReadWorkedOut(files), true);
        const entry = path.join(compileCacheDirectory(root), compileEntryName("read", "src/a.ts\0src/a.sim.ts"));
        assert(files.files.has(entry));
        files.files.set(entry, "garbled\n");
        assert.equal(await isReadWorkedOut(files), true);
        assert.equal(await isReadWorkedOut(files), false);
    });

    test("an entry that cannot be written fails the read loudly", async () => {
        const files = buildProject();
        const entry = path.join(compileCacheDirectory(root), compileEntryName("read", "src/a.ts\0src/a.sim.ts"));
        files.failNext(entry, "EACCES");
        await assert.rejects(cacheOver(files, new CountingReader()).read("src/a.ts", ["src/a.sim.ts"]), /EACCES/);
    });
});

describe("CachedShardReader.measure", () => {
    test("a project file is measured once and later readers give back what was kept", async () => {
        const files = buildProject();
        const url = pathToFileURL(path.join(root, "src/a.ts")).href;
        const inner = new CountingReader();
        const measured = await cacheOver(files, inner).measure(url);
        assert.deepEqual(measured, buildMeasured(url));
        const later = new CountingReader();
        assert.equal(describeValue(await cacheOver(files, later).measure(url)), describeValue(measured));
        assert.equal(later.measures, 0);
    });

    test("a change to the file, its tsconfig, its package.json, the lockfile or Faultline's code measures it again, and an unrelated one does not", async () => {
        const changes: [string, string][] = [
            ["src/a.ts", "export const a = 3;\n"],
            ["tsconfig.json", "{ \"compilerOptions\": { \"strict\": false } }\n"],
            ["package.json", "{ \"type\": \"commonjs\" }\n"],
            ["bun.lock", "lock 2\n"],
            [path.join(toolModules, "main.js"), "main 2\n"],
        ];
        for (const [file, text] of changes) {
            const files = buildProject();
            assert.equal(await isMeasureWorkedOut(files), true);
            files.files.set(path.join(root, "src/other.ts"), "export const other = 9;\n");
            assert.equal(await isMeasureWorkedOut(files), false);
            files.files.set(path.isAbsolute(file) ? file : path.join(root, file), text);
            assert.equal(await isMeasureWorkedOut(files), true, `A change to ${file} did not measure the file again.`);
        }
    });

    test("a project with no package.json is measured and kept, and one added later measures it again", async () => {
        const files = buildProject();
        files.files.delete(path.join(root, "package.json"));
        assert.equal(await isMeasureWorkedOut(files), true);
        assert.equal(await isMeasureWorkedOut(files), false);
        files.files.set(path.join(root, "package.json"), "{ \"type\": \"module\" }\n");
        assert.equal(await isMeasureWorkedOut(files), true);
    });

    test("a URL that names no file of the project is measured every time and never kept", async () => {
        const files = buildProject();
        const inner = new CountingReader();
        const cache = cacheOver(files, inner);
        await cache.measure("node:fs");
        await cache.measure("file:///elsewhere/x.js");
        await cache.measure(pathToFileURL(path.join(root, "src/gone.ts")).href);
        await cache.measure(pathToFileURL(path.join(root, "node_modules/pkg/index.js")).href);
        await cache.measure(pathToFileURL(path.join(root, "node_modules/pkg/index.js")).href);
        assert.equal(inner.measures, 5);
        assert.equal(await files.isDirectory(compileCacheDirectory(root)), false);
    });
});
