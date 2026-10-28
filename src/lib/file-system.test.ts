//
// Checks that the real file system hands every call to `node:fs`, passes its answer back and turns
// a missing path into a no rather than a failure.
//
// The method is to replace `node:fs` with stand-ins through `jest.mock`, call each function and
// each method of `FileSystem`, and check the stand-in was called with the same path and options and
// that what it answered, or the error it gave, came back. No test touches the disk.
//

import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, describe, jest, test } from "@jest/globals";
import { nodeError } from "./fake-files.test.ts";
import { directoryEntries, entryKind, FileSystem, isCodedError, statOrNothing } from "./file-system.ts";

jest.mock("node:fs", () => {
    const actual = jest.requireActual<typeof fs>("node:fs");
    return {
        Dirent: actual.Dirent,
        stat: jest.fn(),
        promises: {
            readFile: jest.fn(),
            readdir: jest.fn(),
            realpath: jest.fn(),
            writeFile: jest.fn(),
            rename: jest.fn(),
            mkdir: jest.fn(),
            rm: jest.fn(),
        },
    };
});

//
// What `stat` answers, as far as `FileSystem` reads it.
//
export interface IFakeStats {
    //
    // Whether the path is a file.
    //
    isFile(): boolean;

    //
    // Whether the path is a directory.
    //
    isDirectory(): boolean;
}

//
// The stats of a path that is a file or a directory.
//
export function statsOf(kind: "file" | "directory"): IFakeStats {
    return {
        isFile: () => kind === "file",
        isDirectory: () => kind === "directory",
    };
}

//
// A directory entry as Node reads one, of the kind named.
//
export function direntOf(name: string, kind: "file" | "directory" | "link"): fs.Dirent {
    const entry = new fs.Dirent();
    entry.name = name;
    entry.isFile = () => kind === "file";
    entry.isDirectory = () => kind === "directory";
    return entry;
}

//
// The stand-in `jest.mock` put in place of a `node:fs` call, checked to be one, so a test reads
// its calls and sets its answers without a cast.
//
export function standIn(called: unknown): jest.Mock {
    assert(jest.isMockFunction(called), "A `node:fs` call the test reads is not one of its stand-ins.");
    return called;
}

//
// The arguments a stand-in was called with, copied out of Jest's realm so they compare.
//
export function callsOf(called: unknown): unknown[][] {
    return Array.from(standIn(called).mock.calls, (call) => Array.from(call));
}

//
// Makes the stand-in for the callback `fs.stat` call back once with `error` and `stats`, the way
// Node does.
//
export function answerStat(error: NodeJS.ErrnoException | null, stats: IFakeStats | undefined): void {
    standIn(fs.stat).mockImplementationOnce((...args: unknown[]) => {
        const callback = args[1];
        assert(typeof callback === "function", "`fs.stat` was called without a callback.");
        Reflect.apply(callback, undefined, [error, stats]);
    });
}

//
// The options every UTF-8 read and write passes, held once so each test checks the same ones.
//
const utf8 = {
    encoding: "utf8",
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe("isCodedError", () => {
    test("an error carrying a code Node gives is coded, and a plain error, a numeric code or a string is not", () => {
        assert.equal(isCodedError(nodeError("ENOENT", "open", "/a.ts")), true);
        assert.equal(isCodedError(new Error("plain")), false);
        const numbered: NodeJS.ErrnoException = new Error("numbered");
        Reflect.set(numbered, "code", 5);
        assert.equal(isCodedError(numbered), false);
        assert.equal(isCodedError("ENOENT"), false);
    });
});

describe("entryKind", () => {
    test("a file, a directory and anything else are told apart", () => {
        assert.equal(entryKind(direntOf("a", "file")), "file");
        assert.equal(entryKind(direntOf("a", "directory")), "directory");
        assert.equal(entryKind(direntOf("a", "link")), "other");
    });

    test("an entry with no name or with a separator in its name is a mistake", () => {
        assert.throws(() => entryKind(direntOf("", "file")), assert.AssertionError);
        assert.throws(() => entryKind(direntOf("a/b", "file")), assert.AssertionError);
    });
});

describe("directoryEntries", () => {
    test("each entry keeps its name and gets its kind, in the order Node read them", () => {
        assert.deepEqual(directoryEntries([direntOf("b.ts", "file"), direntOf("a", "directory")]), [
            {
                name: "b.ts",
                kind: "file",
            },
            {
                name: "a",
                kind: "directory",
            },
        ]);
        assert.deepEqual(directoryEntries([]), []);
    });
});

describe("statOrNothing", () => {
    test("a path that is there gives its stats", async () => {
        const stats = statsOf("file");
        answerStat(null, stats);
        assert.equal(await statOrNothing("/a.ts"), stats);
        assert.equal(callsOf(fs.stat)[0][0], "/a.ts");
    });

    test("a path that is not there gives undefined", async () => {
        answerStat(nodeError("ENOENT", "stat", "/gone.ts"), undefined);
        assert.equal(await statOrNothing("/gone.ts"), undefined);
    });

    test("any other failure rejects with Node's error", async () => {
        const error = nodeError("EACCES", "stat", "/locked.ts");
        answerStat(error, undefined);
        await assert.rejects(statOrNothing("/locked.ts"), error);
    });

    test("a relative path is a mistake and is refused before Node is asked", () => {
        assert.throws(() => statOrNothing("a.ts"), assert.AssertionError);
        assert.equal(callsOf(fs.stat).length, 0);
    });
});

describe("FileSystem", () => {
    const files = new FileSystem();

    test("a read hands the path to readFile as UTF-8 and gives back its text", async () => {
        standIn(fs.promises.readFile).mockReturnValue(Promise.resolve("text"));
        assert.equal(await files.readText("/a/b.ts"), "text");
        assert.deepEqual(callsOf(fs.promises.readFile), [["/a/b.ts", utf8]]);
    });

    test("a read that fails rejects with Node's error, code and all", async () => {
        const error = nodeError("ENOENT", "open", "/gone.ts");
        standIn(fs.promises.readFile).mockReturnValue(Promise.reject(error));
        await assert.rejects(files.readText("/gone.ts"), error);
    });

    test("a relative path or a path ending in a separator is a mistake and is refused before Node is asked", async () => {
        await assert.rejects(files.readText("a.ts"), assert.AssertionError);
        await assert.rejects(files.readText("/a/"), assert.AssertionError);
        assert.equal(callsOf(fs.promises.readFile).length, 0);
    });

    test("a file is there when stat says it is a file, and not when stat finds a directory or nothing", async () => {
        answerStat(null, statsOf("file"));
        assert.equal(await files.isFile("/a"), true);
        answerStat(null, statsOf("directory"));
        assert.equal(await files.isFile("/a"), false);
        answerStat(nodeError("ENOENT", "stat", "/a"), undefined);
        assert.equal(await files.isFile("/a"), false);
    });

    test("a directory is there when stat says it is a directory, and not when stat finds a file or nothing", async () => {
        answerStat(null, statsOf("directory"));
        assert.equal(await files.isDirectory("/d"), true);
        answerStat(null, statsOf("file"));
        assert.equal(await files.isDirectory("/d"), false);
        answerStat(nodeError("ENOENT", "stat", "/d"), undefined);
        assert.equal(await files.isDirectory("/d"), false);
    });

    test("asking about a path stat cannot read rejects with Node's error", async () => {
        const error = nodeError("EACCES", "stat", "/locked");
        answerStat(error, undefined);
        await assert.rejects(files.isFile("/locked"), error);
        answerStat(error, undefined);
        await assert.rejects(files.isDirectory("/locked"), error);
    });

    test("a listing reads the entries with their types and gives each its kind", async () => {
        standIn(fs.promises.readdir).mockReturnValue(Promise.resolve([direntOf("a.ts", "file"), direntOf("src", "directory"), direntOf("link", "link")]));
        assert.deepEqual(await files.listDirectory("/d"), [
            {
                name: "a.ts",
                kind: "file",
            },
            {
                name: "src",
                kind: "directory",
            },
            {
                name: "link",
                kind: "other",
            },
        ]);
        assert.deepEqual(callsOf(fs.promises.readdir), [[
            "/d",
            {
                withFileTypes: true,
            },
        ]]);
    });

    test("a real path is what realpath gives", async () => {
        standIn(fs.promises.realpath).mockReturnValue(Promise.resolve("/real/b.ts"));
        assert.equal(await files.realPath("/a/b.ts"), "/real/b.ts");
        assert.deepEqual(callsOf(fs.promises.realpath), [["/a/b.ts", utf8]]);
    });

    test("a real path that is not absolute is a mistake in what Node gave", async () => {
        standIn(fs.promises.realpath).mockReturnValue(Promise.resolve("b.ts"));
        await assert.rejects(files.realPath("/a/b.ts"), assert.AssertionError);
    });

    test("a write, a new directory and a removal go to writeFile, mkdir and rm with their options", async () => {
        standIn(fs.promises.writeFile).mockReturnValue(Promise.resolve());
        standIn(fs.promises.mkdir).mockReturnValue(Promise.resolve());
        standIn(fs.promises.rm).mockReturnValue(Promise.resolve());
        await files.writeText("/d/a.txt", "text");
        await files.makeDirectory("/d/e");
        await files.removeDirectory("/d");
        assert.deepEqual(callsOf(fs.promises.writeFile), [["/d/a.txt", "text", utf8]]);
        assert.deepEqual(callsOf(fs.promises.mkdir), [[
            "/d/e",
            {
                recursive: true,
            },
        ]]);
        assert.deepEqual(callsOf(fs.promises.rm), [[
            "/d",
            {
                recursive: true,
                force: true,
            },
        ]]);
    });

    test("a move goes to rename, and one between directories is refused before Node is asked", async () => {
        standIn(fs.promises.rename).mockReturnValue(Promise.resolve());
        await files.rename("/d/a.tmp", "/d/a.txt");
        assert.deepEqual(callsOf(fs.promises.rename), [["/d/a.tmp", "/d/a.txt"]]);
        await assert.rejects(files.rename("/d/a.tmp", "/e/a.txt"), /not in the same directory/);
        await assert.rejects(files.rename("a.tmp", "/d/a.txt"), assert.AssertionError);
        assert.equal(callsOf(fs.promises.rename).length, 1);
    });

    test("making or removing the root is a mistake and is refused before Node is asked", async () => {
        await assert.rejects(files.makeDirectory("/"), assert.AssertionError);
        await assert.rejects(files.removeDirectory("/"), assert.AssertionError);
        assert.equal(callsOf(fs.promises.mkdir).length, 0);
        assert.equal(callsOf(fs.promises.rm).length, 0);
    });
});
