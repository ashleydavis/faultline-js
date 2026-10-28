//
// Tests the module Node loads on its loader thread. The goal is that it builds one loader when Node
// starts it, over the real file system, and hands every resolve and load request to that loader.
//
// The method is to replace `FileSystem` through `jest.mock` with a file system in memory holding a
// small project and the tool's simulated `node:fs`, call `initialize` as Node does with the run's
// settings, then call `resolve` and `load` as Node does and read their answers. No test reads the
// disk or starts a thread.
//

import assert from "node:assert/strict";
import type module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, jest, test } from "@jest/globals";
import { createFakeFileSystem } from "../lib/fake-files.test.ts";
import type * as fileSystemModule from "../lib/file-system.ts";
import { FileSystem } from "../lib/file-system.ts";
import { createLoader } from "./hooks.ts";
import type { ILoadSettings, NextLoad, NextResolve } from "./hooks.ts";
import { initialize, load, loaderOf, resolve } from "./loader-thread.ts";

//
// Every `FileSystem` the loader thread builds is a new file system in memory from
// `threadFileSystem`, which is declared as a function so the mock can name it before the rest of
// this file has run.
//
jest.mock("../lib/file-system.ts", () => {
    return {
        ...jest.requireActual<typeof fileSystemModule>("../lib/file-system.ts"),
        FileSystem: jest.fn(threadFileSystem),
    };
});

//
// The run the loader thread is started for.
//
const settings: ILoadSettings = {
    projectRoot: "/work/project",
    toolModules: "/faultline/src",
};

//
// The file system in memory the replaced `FileSystem` hands out: a project with one import between
// two files and the tool's simulated `node:fs`.
//
export function threadFileSystem(): fileSystemModule.IFileSystem {
    return createFakeFileSystem({
        [path.join(settings.projectRoot, "package.json")]: "{ \"name\": \"project\", \"type\": \"module\" }\n",
        [path.join(settings.projectRoot, "main.ts")]: "import { helper } from \"./helper\";\nexport const value = helper();\n",
        [path.join(settings.projectRoot, "helper.ts")]: "export function helper(): number { return 1; }\n",
        [path.join(settings.toolModules, "world", "effects", "fs.ts")]: "export {};\n",
    });
}

//
// The context Node gives the resolve hook for an import written in the project's `main.ts`.
//
const resolveContext: module.ResolveHookContext = {
    conditions: ["node", "import"],
    importAttributes: {},
    parentURL: pathToFileURL(path.join(settings.projectRoot, "main.ts")).href,
};

//
// The context Node gives the load hook.
//
const loadContext: module.LoadHookContext = {
    conditions: ["node", "import"],
    format: undefined,
    importAttributes: {},
};

//
// A stand-in for Node's own resolve hook that answers with a URL saying it was Node's answer.
//
export function nodeResolve(): NextResolve {
    return (specifier: string) => {
        return {
            url: `next:${specifier}`,
        };
    };
}

//
// A stand-in for Node's own load hook that answers with no source.
//
export function nodeLoad(): NextLoad {
    return () => {
        return {
            format: "next",
        };
    };
}

describe("loaderOf", () => {
    test("the one loader started is the loader", () => {
        const loader = createLoader(settings, threadFileSystem());
        assert.equal(loaderOf([loader]), loader);
    });

    test("no loader, or more than one, is refused", () => {
        const loader = createLoader(settings, threadFileSystem());
        assert.throws(() => loaderOf([]), /before it was started/);
        assert.throws(() => loaderOf([loader, loader]), assert.AssertionError);
    });
});

describe("the loader thread", () => {
    test("requests before initialize are refused, and after it each one goes to the loader it built", async () => {
        assert.throws(() => resolve("./helper", resolveContext, nodeResolve()), /before it was started/);
        assert.throws(() => load("node:path", loadContext, nodeLoad()), /before it was started/);

        initialize(settings);
        assert.equal(jest.mocked(FileSystem).mock.calls.length, 1);

        const helper = await resolve("./helper", resolveContext, nodeResolve());
        assert.equal(helper.url, pathToFileURL(path.join(settings.projectRoot, "helper.ts")).href);
        const simulated = await resolve("node:fs", resolveContext, nodeResolve());
        assert.equal(simulated.url, pathToFileURL(path.join(settings.toolModules, "world", "effects", "fs.ts")).href);
        const elsewhere = await resolve("some-package", resolveContext, nodeResolve());
        assert.equal(elsewhere.url, "next:some-package");

        const loaded = await load(helper.url, loadContext, nodeLoad());
        assert.equal(loaded.format, "module");
        assert.match(String(loaded.source), /export function helper\(\)/);
        const builtIn = await load("node:path", loadContext, nodeLoad());
        assert.equal(builtIn.format, "next");

        assert.throws(() => resolve("", resolveContext, nodeResolve()), assert.AssertionError);
        assert.throws(() => load("", loadContext, nodeLoad()), assert.AssertionError);
        assert.throws(() => initialize(settings), /started twice/);
    });
});
