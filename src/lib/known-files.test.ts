//
// Checks that the answers held in memory for the compiler give back what was read, write down every
// question they cannot answer, read those answers in from a file system and stop a build that never
// stops asking.
//
// The method is to put a few files in the file system in memory from `fake-files.test.ts`, ask the
// functions of `known-files.ts` about them, and check both the answer and the misses written down.
// A build is a small function that reads through the answers the way the compiler does. No test
// touches the disk.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { createFakeFileSystem, nodeError } from "./fake-files.test.ts";
import type { IDirectoryEntry, IFileSystem } from "./file-system.ts";
import {
    addMiss,
    answerMiss,
    answerMisses,
    createKnownFiles,
    createReading,
    knownIsDirectory,
    knownIsFile,
    knownListing,
    knownRealPath,
    knownText,
    listingOrNothing,
    readTextOrNothing,
    realPathOrSelf,
    roundsMost,
    untilKnown,
    type IKnownFiles,
} from "./known-files.ts";

//
// A file system in memory whose every read, listing and link rejects with `error`, for the failures
// Node never gives and the fake cannot make.
//
export function failingFileSystem(error: Error): IFileSystem {
    return {
        ...createFakeFileSystem({}),
        readText: () => Promise.reject(error),
        listDirectory: () => Promise.reject(error),
        realPath: () => Promise.reject(error),
    };
}

//
// The text a build reads `file` as: the text known, or an empty string when it is not known yet.
//
export function textOrEmpty(known: IKnownFiles, file: string): string {
    return knownText(known, file) ?? "";
}

describe("createReading", () => {
    test("a reading keeps the file system it was given and has read nothing", () => {
        const files = createFakeFileSystem({});
        const reading = createReading(files);
        assert.equal(reading.fileSystem, files);
        assert.equal(reading.known.texts.size, 0);
        assert.equal(reading.known.misses.length, 0);
    });
});

describe("createKnownFiles", () => {
    test("new answers hold nothing, and two of them share nothing", () => {
        const first = createKnownFiles();
        const second = createKnownFiles();
        assert.equal(first.texts.size, 0);
        assert.equal(first.files.size, 0);
        assert.equal(first.directories.size, 0);
        assert.equal(first.listings.size, 0);
        assert.equal(first.realPaths.size, 0);
        assert.equal(first.parsed.size, 0);
        assert.deepEqual(first.misses, []);
        assert.notEqual(first.texts, second.texts);
        assert.notEqual(first.misses, second.misses);
    });
});

describe("addMiss", () => {
    test("a miss is written down with its kind and path, after the ones before it", () => {
        const known = createKnownFiles();
        addMiss(known, "text", "/a.ts");
        addMiss(known, "listing", "/d");
        assert.deepEqual(known.misses, [
            {
                kind: "text",
                path: "/a.ts",
            },
            {
                kind: "listing",
                path: "/d",
            },
        ]);
    });

    test("a relative path is a mistake and says which path it was", () => {
        const known = createKnownFiles();
        assert.throws(() => addMiss(known, "file", "a.ts"), /The compiler asked about a\.ts, which is not an absolute path\./);
        assert.equal(known.misses.length, 0);
    });
});

describe("knownText", () => {
    test("a file not read yet is a miss and has no text", () => {
        const known = createKnownFiles();
        assert.equal(knownText(known, "/a.ts"), undefined);
        assert.deepEqual(known.misses, [
            {
                kind: "text",
                path: "/a.ts",
            },
        ]);
    });

    test("a file read gives its text, and one read as not readable gives none, without a miss", () => {
        const known = createKnownFiles();
        known.texts.set("/a.ts", "text");
        known.texts.set("/gone.ts", undefined);
        assert.equal(knownText(known, "/a.ts"), "text");
        assert.equal(knownText(known, "/gone.ts"), undefined);
        assert.equal(known.misses.length, 0);
    });

    test("a relative path is a mistake", () => {
        assert.throws(() => knownText(createKnownFiles(), "a.ts"), assert.AssertionError);
    });
});

describe("knownIsFile", () => {
    test("a path not asked about yet is a miss and is not a file", () => {
        const known = createKnownFiles();
        assert.equal(knownIsFile(known, "/a.ts"), false);
        assert.deepEqual(known.misses, [
            {
                kind: "file",
                path: "/a.ts",
            },
        ]);
    });

    test("a path asked about gives the answer read, without a miss", () => {
        const known = createKnownFiles();
        known.files.set("/a.ts", true);
        known.files.set("/d", false);
        assert.equal(knownIsFile(known, "/a.ts"), true);
        assert.equal(knownIsFile(known, "/d"), false);
        assert.equal(known.misses.length, 0);
    });

    test("a path known as both a file and a directory is a mistake", () => {
        const known = createKnownFiles();
        known.files.set("/a", true);
        known.directories.set("/a", true);
        assert.throws(() => knownIsFile(known, "/a"), assert.AssertionError);
        assert.throws(() => knownIsFile(known, "a"), assert.AssertionError);
    });
});

describe("knownIsDirectory", () => {
    test("a path not asked about yet is a miss and is not a directory", () => {
        const known = createKnownFiles();
        assert.equal(knownIsDirectory(known, "/d"), false);
        assert.deepEqual(known.misses, [
            {
                kind: "directory",
                path: "/d",
            },
        ]);
    });

    test("a path asked about gives the answer read, without a miss", () => {
        const known = createKnownFiles();
        known.directories.set("/d", true);
        known.directories.set("/a.ts", false);
        assert.equal(knownIsDirectory(known, "/d"), true);
        assert.equal(knownIsDirectory(known, "/a.ts"), false);
        assert.equal(known.misses.length, 0);
    });

    test("a path known as both a directory and a file is a mistake", () => {
        const known = createKnownFiles();
        known.directories.set("/a", true);
        known.files.set("/a", true);
        assert.throws(() => knownIsDirectory(known, "/a"), assert.AssertionError);
        assert.throws(() => knownIsDirectory(known, "a"), assert.AssertionError);
    });
});

describe("knownListing", () => {
    test("a directory not listed yet is a miss and has no entries", () => {
        const known = createKnownFiles();
        assert.deepEqual(knownListing(known, "/d"), []);
        assert.deepEqual(known.misses, [
            {
                kind: "listing",
                path: "/d",
            },
        ]);
    });

    test("a directory listed gives its entries, without a miss", () => {
        const known = createKnownFiles();
        const entries: IDirectoryEntry[] = [
            {
                name: "a.ts",
                kind: "file",
            },
        ];
        known.listings.set("/d", entries);
        known.listings.set("/e", []);
        assert.equal(knownListing(known, "/d"), entries);
        assert.deepEqual(knownListing(known, "/e"), []);
        assert.equal(known.misses.length, 0);
    });

    test("entries for a path known not to be a directory are a mistake", () => {
        const known = createKnownFiles();
        known.listings.set("/a", [
            {
                name: "b",
                kind: "file",
            },
        ]);
        known.directories.set("/a", false);
        assert.throws(() => knownListing(known, "/a"), assert.AssertionError);
        assert.throws(() => knownListing(known, "a"), assert.AssertionError);
    });
});

describe("knownRealPath", () => {
    test("a path not followed yet is a miss and leads to itself", () => {
        const known = createKnownFiles();
        assert.equal(knownRealPath(known, "/link.ts"), "/link.ts");
        assert.deepEqual(known.misses, [
            {
                kind: "real-path",
                path: "/link.ts",
            },
        ]);
    });

    test("a path followed gives where it leads, without a miss", () => {
        const known = createKnownFiles();
        known.realPaths.set("/link.ts", "/real/a.ts");
        assert.equal(knownRealPath(known, "/link.ts"), "/real/a.ts");
        assert.equal(known.misses.length, 0);
    });

    test("a relative path, asked or known, is a mistake", () => {
        const known = createKnownFiles();
        known.realPaths.set("/link.ts", "a.ts");
        assert.throws(() => knownRealPath(known, "/link.ts"), assert.AssertionError);
        assert.throws(() => knownRealPath(known, "link.ts"), assert.AssertionError);
    });
});

describe("readTextOrNothing", () => {
    test("a file gives its text, and a missing file or one that cannot be read gives none", async () => {
        const files = createFakeFileSystem({
            "/a.ts": "text",
        });
        assert.equal(await readTextOrNothing(files, "/a.ts"), "text");
        assert.equal(await readTextOrNothing(files, "/gone.ts"), undefined);
        files.failNext("/a.ts", "EIO");
        assert.equal(await readTextOrNothing(files, "/a.ts"), undefined);
    });

    test("a failure Node never gives, or a broken assertion, is a mistake and is not taken for a missing file", async () => {
        await assert.rejects(readTextOrNothing(failingFileSystem(new Error("plain")), "/a.ts"), /Reading \/a\.ts failed with something that is not an error Node raised\./);
        await assert.rejects(readTextOrNothing(failingFileSystem(new assert.AssertionError({
            message: "inner",
        })), "/a.ts"), /Reading \/a\.ts broke an assertion in the file system/);
    });

    test("a relative path is a mistake", async () => {
        await assert.rejects(readTextOrNothing(createFakeFileSystem({}), "a.ts"), assert.AssertionError);
    });
});

describe("listingOrNothing", () => {
    test("a directory gives its entries, and a file or a missing path gives none", async () => {
        const files = createFakeFileSystem({
            "/d/a.ts": "text",
        });
        assert.deepEqual(await listingOrNothing(files, "/d"), [
            {
                name: "a.ts",
                kind: "file",
            },
        ]);
        assert.deepEqual(await listingOrNothing(files, "/d/a.ts"), []);
        assert.deepEqual(await listingOrNothing(files, "/gone"), []);
    });

    test("a directory that cannot be read rejects with Node's error", async () => {
        const files = createFakeFileSystem({
            "/d/a.ts": "text",
        });
        files.failNext("/d", "EACCES");
        await assert.rejects(listingOrNothing(files, "/d"), nodeError("EACCES", "stat", "/d"));
        await assert.rejects(listingOrNothing(files, "d"), assert.AssertionError);
    });
});

describe("realPathOrSelf", () => {
    test("a path that is there leads where it leads, and one that cannot be followed leads to itself", async () => {
        const files = createFakeFileSystem({
            "/a.ts": "text",
        });
        assert.equal(await realPathOrSelf(files, "/a.ts"), "/a.ts");
        assert.equal(await realPathOrSelf(files, "/gone.ts"), "/gone.ts");
    });

    test("a failure Node never gives, or a broken assertion, is a mistake", async () => {
        await assert.rejects(realPathOrSelf(failingFileSystem(new Error("plain")), "/a.ts"), /Following \/a\.ts failed with something that is not an error Node raised\./);
        await assert.rejects(realPathOrSelf(failingFileSystem(new assert.AssertionError({
            message: "inner",
        })), "/a.ts"), /Following \/a\.ts broke an assertion in the file system/);
        await assert.rejects(realPathOrSelf(createFakeFileSystem({}), "a.ts"), assert.AssertionError);
    });

    test("a real path that is not absolute is a mistake in the file system", async () => {
        const files: IFileSystem = {
            ...createFakeFileSystem({}),
            realPath: () => Promise.resolve("a.ts"),
        };
        await assert.rejects(realPathOrSelf(files, "/a.ts"), assert.AssertionError);
    });
});

describe("answerMiss", () => {
    test("each kind of miss is read into the answers it belongs to", async () => {
        const files = createFakeFileSystem({
            "/d/a.ts": "text",
        });
        const known = createKnownFiles();
        await answerMiss(files, known, {
            kind: "text",
            path: "/d/a.ts",
        });
        await answerMiss(files, known, {
            kind: "file",
            path: "/d/a.ts",
        });
        await answerMiss(files, known, {
            kind: "directory",
            path: "/d",
        });
        await answerMiss(files, known, {
            kind: "listing",
            path: "/d",
        });
        await answerMiss(files, known, {
            kind: "real-path",
            path: "/d/a.ts",
        });
        assert.equal(known.texts.get("/d/a.ts"), "text");
        assert.equal(known.files.get("/d/a.ts"), true);
        assert.equal(known.directories.get("/d"), true);
        assert.deepEqual(known.listings.get("/d"), [
            {
                name: "a.ts",
                kind: "file",
            },
        ]);
        assert.equal(known.realPaths.get("/d/a.ts"), "/d/a.ts");
    });

    test("a miss with a relative path is a mistake", async () => {
        await assert.rejects(answerMiss(createFakeFileSystem({}), createKnownFiles(), {
            kind: "text",
            path: "a.ts",
        }), assert.AssertionError);
    });
});

describe("answerMisses", () => {
    test("every miss is read in and the misses are forgotten", async () => {
        const files = createFakeFileSystem({
            "/a.ts": "text",
        });
        const known = createKnownFiles();
        addMiss(known, "text", "/a.ts");
        addMiss(known, "file", "/gone.ts");
        await answerMisses(files, known);
        assert.equal(known.texts.get("/a.ts"), "text");
        assert.equal(known.files.get("/gone.ts"), false);
        assert.equal(known.misses.length, 0);
    });

    test("reading with no misses is a mistake", async () => {
        await assert.rejects(answerMisses(createFakeFileSystem({}), createKnownFiles()), /There are no misses to read/);
    });
});

describe("untilKnown", () => {
    test("a build that misses is run again with the misses read, until it misses nothing", async () => {
        const files = createFakeFileSystem({
            "/a.ts": "/b.ts",
            "/b.ts": "done",
        });
        const reading = createReading(files);
        const builds: string[] = [];
        const built = await untilKnown(reading, () => {
            const first = textOrEmpty(reading.known, "/a.ts");
            const second = first ? textOrEmpty(reading.known, first) : "";
            builds.push(second);
            return second;
        });
        assert.equal(built, "done");
        assert.deepEqual(builds, ["", "", "done"]);
        assert.equal(reading.known.misses.length, 0);
    });

    test("a build that misses nothing is run once", async () => {
        const reading = createReading(createFakeFileSystem({}));
        let runs = 0;
        assert.equal(await untilKnown(reading, () => {
            runs += 1;
            return "built";
        }), "built");
        assert.equal(runs, 1);
    });

    test("misses left by another build are a mistake", async () => {
        const reading = createReading(createFakeFileSystem({}));
        addMiss(reading.known, "text", "/a.ts");
        await assert.rejects(untilKnown(reading, () => "built"), /Misses from another build are waiting to be read\./);
    });

    test("a build that asks something new every time is stopped after the most rounds", async () => {
        const reading = createReading(createFakeFileSystem({}));
        let runs = 0;
        await assert.rejects(untilKnown(reading, () => {
            runs += 1;
            return knownIsFile(reading.known, `/file-${runs}.ts`);
        }), new RegExp(`The compiler was still asking for files after ${roundsMost} rounds, which is a defect in Faultline\\.`));
        assert.equal(runs, roundsMost);
    });
});
