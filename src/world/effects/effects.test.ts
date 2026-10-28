//
// Checks which built-in modules a run replaces.
//
// The goal is to show that each built-in module the failure table names has a replacement found by
// every one of its spellings, that a built replacement is found ahead of its TypeScript and that a
// name no replacement answers to is left alone. The method is to look each name up in a directory
// held in a file system in memory, which holds a file for every replacement. That a project file
// and a package both reach the replacements is checked by `src/smoke/simulated-fs.smoke.ts`,
// because only a Node process with the module hooks registered can load them.
//

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "@jest/globals";
import { createFakeFileSystem } from "../../lib/fake-files.test.ts";
import { effectModuleFiles, effectModuleFor } from "./index.ts";

//
// The directory the replacements sit in, in memory.
//
const directory = path.join(path.parse(process.cwd()).root, "faultline", "src", "world", "effects");

//
// Each replaced module by the name it is found under, with every name it answers to.
//
const spellings = new Map<string, string[]>([
    ["fs", ["node:fs", "fs"]],
    ["fs-promises", ["node:fs/promises", "fs/promises"]],
    ["dns", ["node:dns", "dns"]],
    ["dns-promises", ["node:dns/promises", "dns/promises"]],
    ["http", ["node:http", "http", "node:https", "https"]],
    ["net", ["node:net", "net"]],
    ["child-process", ["node:child_process", "child_process"]],
    ["os", ["node:os", "os"]],
    ["crypto", ["node:crypto", "crypto"]],
    ["timers", ["node:timers", "timers"]],
    ["timers-promises", ["node:timers/promises", "timers/promises"]],
    ["inspector", ["node:inspector", "inspector", "node:inspector/promises", "inspector/promises"]],
]);

//
// A replacement for every module, as TypeScript, the way a clone holds them.
//
const files = createFakeFileSystem(Object.fromEntries([...spellings.keys()].map((file) => [path.join(directory, `${file}.ts`), ""])));

describe("effectModuleFor", () => {
    for (const [file, names] of spellings) {
        test(`every name of ${file} finds its replacement`, async () => {
            for (const name of names) {
                assert.equal(await effectModuleFor(files, name, directory), path.join(directory, `${file}.ts`), name);
            }
        });
    }

    test("a replacement built to JavaScript is found ahead of its TypeScript, as in an installed copy", async () => {
        const installed = createFakeFileSystem({
            [path.join(directory, "fs.js")]: "",
            [path.join(directory, "fs.ts")]: "",
        });
        assert.equal(await effectModuleFor(installed, "node:fs", directory), path.join(directory, "fs.js"));
    });

    test("a module the run does not replace is left where it is", async () => {
        assert.equal(await effectModuleFor(files, "node:path", directory), undefined);
        assert.equal(await effectModuleFor(files, "express", directory), undefined);
    });

    test("a name an object holds by inheritance is not taken for a replaced module", async () => {
        assert.equal(await effectModuleFor(files, "constructor", directory), undefined);
        assert.equal(await effectModuleFor(files, "toString", directory), undefined);
    });

    test("a replaced module whose file is not in the directory named is not found there", async () => {
        assert.equal(await effectModuleFor(files, "node:fs", path.dirname(directory)), undefined);
    });

    test("a directory that is not absolute is a programmer error", async () => {
        await assert.rejects(effectModuleFor(files, "node:fs", "effects"), assert.AssertionError);
    });

    test("an empty name is a programmer error", async () => {
        await assert.rejects(effectModuleFor(files, "", directory), assert.AssertionError);
    });
});

describe("effectModuleFiles", () => {
    test("every name a replaced module is imported by is found at once, for a hook that cannot wait", async () => {
        const found = await effectModuleFiles(files, directory);
        assert.equal(found.size, [...spellings.values()].flat().length);
        for (const [file, names] of spellings) {
            for (const name of names) {
                assert.equal(found.get(name), path.join(directory, `${file}.ts`), name);
            }
        }
        assert.equal(found.has("node:path"), false);
    });

    test("a directory holding no replacement finds none, and one that is not absolute is a programmer error", async () => {
        assert.equal((await effectModuleFiles(files, path.dirname(directory))).size, 0);
        await assert.rejects(effectModuleFiles(files, "effects"), assert.AssertionError);
    });
});
