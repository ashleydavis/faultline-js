// Checks the simulated filesystem.
//
// Each operation is checked two ways. A table names, for each operation, the place under test and
// what each failure possible there does: the operation is run with no failure planned to show the
// place lists exactly those failures, then once per failure with that failure planned, to show the
// operation fails as `docs/FAILURES.md` says. Then the operations are run with no failure planned to
// show the tree behaves as Linux does: links, sorted listings, open files and the rest.
//
// The files an operation needs are written first with injection switched off, so writing them is
// not a place.

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { RunClock } from "./clock.ts";
import type { Effect } from "./failures.ts";
import { RunFiles } from "./filesystem.ts";
import { Injector, type PlannedFailure } from "./injector.ts";
import { SeededRng } from "./random.ts";

// A tree whose calls are answered by `injector`.
function treeWith(injector: Injector): RunFiles {
    return new RunFiles(injector, new RunClock(injector), new SeededRng(1));
}

// A tree planned with `planned`, set up by `setup` with injection off.
function preparedTree(planned: PlannedFailure | undefined, setup: (files: RunFiles) => void): { files: RunFiles; injector: Injector } {
    const injector = new Injector(planned);
    const files = treeWith(injector);
    injector.setInjecting(false);
    setup(files);
    injector.setInjecting(true);
    return {
        files,
        injector,
    };
}

// The text a file holds.
function textOf(files: RunFiles, at: string): string {
    return files.readFile(at).toString("utf8");
}

// The code an error carries.
function codeOfThrown(thrown: unknown): string | undefined {
    return (thrown as { code?: string }).code;
}

// What one failure does to an operation: the code it fails with, or a check of what it did.
type FailureCheck = string | ((outcome: Outcome, files: RunFiles) => void);

// What an operation did: what it handed back, or what it threw.
interface Outcome {
    // What it handed back, when it returned.
    answer: unknown;

    // What it threw, when it threw.
    thrown: unknown;
}

// One operation and what every failure at its place does.
interface FailureCase {
    // What the operation is.
    name: string;

    // The place under test.
    effect: Effect;

    // How many calls of that effect come before it.
    occurrence: number;

    // Writes what the operation needs.
    setup(files: RunFiles): void;

    // Makes the operation.
    act(files: RunFiles): unknown;

    // What each failure possible at the place does, by failure id.
    failures: Record<string, FailureCheck>;
}

// Runs an operation and says what it did.
function outcomeOf(work: () => unknown): Outcome {
    try {
        return {
            answer: work(),
            thrown: undefined,
        };
    }
    catch (thrown) {
        return {
            answer: undefined,
            thrown,
        };
    }
}

// Writes a file with a few bytes in it, and the directories above it.
function seedFile(files: RunFiles, at: string, text: string): void {
    const parent = at.slice(0, at.lastIndexOf("/"));
    if (parent !== "") {
        files.makeDirectory(parent, true, 0o777);
    }
    files.writeFile(at, Buffer.from(text), false, false);
}

// The checks a call that opens to read is given: each failure fails with its code.
const openToReadChecks: Record<string, FailureCheck> = {
    "file-not-found": "ENOENT",
    "access-denied": "EACCES",
    "is-a-directory": "EISDIR",
    "not-a-directory": "ENOTDIR",
    "name-too-long": "ENAMETOOLONG",
    "symlink-loop": "ELOOP",
    "too-many-open-files": "EMFILE",
};

// The same for a call that opens to write.
const openToWriteChecks: Record<string, FailureCheck> = {
    ...openToReadChecks,
    "out-of-space": "ENOSPC",
    "read-only-filesystem": "EROFS",
};

// The same for writing a file whole.
const writeWholeChecks: Record<string, FailureCheck> = {
    "out-of-space": "ENOSPC",
    "input-or-output-error": "EIO",
    "quota-exceeded": "EDQUOT",
    "read-only-filesystem": "EROFS",
};

// The same for making a link.
const makeLinkChecks: Record<string, FailureCheck> = {
    "create-over-an-existing-path": "EEXIST",
    "create-without-permission": "EACCES",
    "create-in-a-missing-directory": "ENOENT",
    "out-of-space": "ENOSPC",
};

// The same for changing a path's permissions, owner or times.
const attributeChecks: Record<string, FailureCheck> = {
    "access-denied": "EACCES",
    "not-permitted": "EPERM",
    "file-not-found": "ENOENT",
    "input-or-output-error": "EIO",
    "read-only-filesystem": "EROFS",
    "symlink-loop": "ELOOP",
};

// The same for making a directory.
const makeDirectoryChecks: Record<string, FailureCheck> = {
    "access-denied": "EACCES",
    "parent-is-not-a-directory": "ENOTDIR",
    "out-of-space": "ENOSPC",
    "quota-exceeded": "EDQUOT",
    "read-only-filesystem": "EROFS",
};

// What a failure that hands back an empty listing does.
function listsNothing(outcome: Outcome): void {
    assert.equal(outcome.thrown, undefined);
    assert.deepEqual(outcome.answer, []);
}

// Every operation and what every failure at its place does.
const failureCases: FailureCase[] = [
    {
        name: "reading a file whole, opening it",
        effect: "file-open",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.readFile("/a.txt"),
        failures: openToReadChecks,
    },
    {
        name: "reading a file whole, reading it",
        effect: "read",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.readFile("/a.txt"),
        failures: {
            "input-or-output-error": "EIO",
            "read-of-a-directory": "EISDIR",
        },
    },
    {
        name: "reading a file through a link",
        effect: "link",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/a.txt", "abc");
            files.symlink("/a.txt", "/link");
        },
        act: (files) => files.readFile("/link"),
        failures: {
            "dangling-link": "ENOENT",
            "link-loop": "ELOOP",
        },
    },
    {
        name: "writing a file whole, opening it",
        effect: "file-open",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.writeFile("/a.txt", Buffer.from("x"), false, false),
        failures: openToWriteChecks,
    },
    {
        name: "writing a file whole exclusively, opening it",
        effect: "file-open",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.writeFile("/a.txt", Buffer.from("x"), false, true),
        failures: {
            ...openToWriteChecks,
            "already-exists": "EEXIST",
        },
    },
    {
        name: "writing a file whole, writing it",
        effect: "write",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.writeFile("/a.txt", Buffer.from("x"), false, false),
        failures: writeWholeChecks,
    },
    {
        name: "reading what a path is",
        effect: "file-open",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.stat("/a.txt", true),
        failures: {
            "file-not-found": "ENOENT",
            "access-denied": "EACCES",
            "not-a-directory": "ENOTDIR",
            "name-too-long": "ENAMETOOLONG",
            "symlink-loop": "ELOOP",
        },
    },
    {
        name: "listing a directory",
        effect: "directory-listing",
        occurrence: 0,
        setup: (files) => seedFile(files, "/d/a.txt", "abc"),
        act: (files) => files.listDirectory("/d", false),
        failures: {
            "open-a-missing-directory": "ENOENT",
            "open-a-file-as-a-directory": "ENOTDIR",
            "access-denied": "EACCES",
            "empty-directory": listsNothing,
            "too-many-open-files": "EMFILE",
        },
    },
    {
        name: "opening a directory to read entry by entry",
        effect: "directory-listing",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/d/a.txt", "a");
            seedFile(files, "/d/b.txt", "b");
            seedFile(files, "/d/c.txt", "c");
        },
        act: (files) => files.openDirectory("/d"),
        failures: {
            "open-a-missing-directory": "ENOENT",
            "open-a-file-as-a-directory": "ENOTDIR",
            "access-denied": "EACCES",
            "empty-directory": (outcome) => {
                assert.deepEqual(outcome.answer, {
                    paths: [],
                    failsAfter: undefined,
                });
            },
            "too-many-open-files": "EMFILE",
            "error-part-way-through-the-listing": (outcome) => {
                assert.deepEqual(outcome.answer, {
                    paths: ["/d/a.txt", "/d/b.txt", "/d/c.txt"],
                    failsAfter: 2,
                });
            },
        },
    },
    {
        name: "making a directory",
        effect: "make-directory",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.makeDirectory("/d", false, 0o777),
        failures: {
            ...makeDirectoryChecks,
            "already-exists": "EEXIST",
            "parent-directory-missing": "ENOENT",
        },
    },
    {
        name: "making a directory and those above it",
        effect: "make-directory",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.makeDirectory("/d/e", true, 0o777),
        failures: makeDirectoryChecks,
    },
    {
        name: "making a temporary directory",
        effect: "make-directory",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.makeTemporaryDirectory("/tmp-"),
        failures: {
            ...makeDirectoryChecks,
            "parent-directory-missing": "ENOENT",
        },
    },
    {
        name: "removing a file",
        effect: "delete",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.unlink("/a.txt"),
        failures: {
            "file-not-found": "ENOENT",
            "access-denied": "EACCES",
            "file-in-use": "EBUSY",
            "is-a-directory": "EISDIR",
            "read-only-filesystem": "EROFS",
        },
    },
    {
        name: "removing a link",
        effect: "link",
        occurrence: 0,
        setup: (files) => files.symlink("/nowhere", "/link"),
        act: (files) => files.unlink("/link"),
        failures: {
            "remove-a-link-that-is-missing": "ENOENT",
        },
    },
    {
        name: "removing an empty directory",
        effect: "delete",
        occurrence: 0,
        setup: (files) => files.makeDirectory("/d", false, 0o777),
        act: (files) => files.removeDirectory("/d"),
        failures: {
            "file-not-found": "ENOENT",
            "access-denied": "EACCES",
            "file-in-use": "EBUSY",
            "not-a-directory": "ENOTDIR",
            "directory-not-empty": "ENOTEMPTY",
            "symlink-loop": "ELOOP",
            "read-only-filesystem": "EROFS",
        },
    },
    {
        name: "removing a path",
        effect: "delete",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.remove("/a.txt", false, false),
        failures: {
            "file-not-found": "ENOENT",
            "access-denied": "EACCES",
            "file-in-use": "EBUSY",
            "symlink-loop": "ELOOP",
            "read-only-filesystem": "EROFS",
        },
    },
    {
        name: "removing a path that may not be there",
        effect: "delete",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.remove("/a.txt", false, true),
        failures: {
            "access-denied": "EACCES",
            "file-in-use": "EBUSY",
            "symlink-loop": "ELOOP",
            "read-only-filesystem": "EROFS",
        },
    },
    {
        name: "removing a tree",
        effect: "delete",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/d/a.txt", "a");
            seedFile(files, "/d/b.txt", "b");
        },
        act: (files) => files.remove("/d", true, false),
        failures: {
            "file-not-found": "ENOENT",
            "access-denied": "EACCES",
            "file-in-use": "EBUSY",
            "symlink-loop": "ELOOP",
            "read-only-filesystem": "EROFS",
            "error-part-way-through-deleting-a-tree": (outcome, files) => {
                assert.equal(codeOfThrown(outcome.thrown), "EIO");
                assert.equal(files.kindAt("/d/b.txt"), undefined);
                assert.equal(files.kindAt("/d/a.txt"), "file");
                assert.equal(files.kindAt("/d"), "directory");
            },
        },
    },
    {
        name: "renaming",
        effect: "rename-copy",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.rename("/a.txt", "/b.txt"),
        failures: {
            "source-not-found": "ENOENT",
            "access-denied": "EACCES",
            "destination-is-a-non-empty-directory": "ENOTEMPTY",
            "destination-is-a-directory": "EISDIR",
            "file-in-use": "EBUSY",
            "across-filesystems": "EXDEV",
            "out-of-space": "ENOSPC",
            "quota-exceeded": "EDQUOT",
            "read-only-filesystem": "EROFS",
        },
    },
    {
        name: "copying a file",
        effect: "rename-copy",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abcd"),
        act: (files) => files.copyFile("/a.txt", "/b.txt", false),
        failures: {
            "source-not-found": "ENOENT",
            "access-denied": "EACCES",
            "destination-is-a-directory": "EISDIR",
            "file-in-use": "EBUSY",
            "out-of-space": "ENOSPC",
            "quota-exceeded": "EDQUOT",
            "read-only-filesystem": "EROFS",
            "copy-fails-part-way-through": (outcome, files) => {
                assert.equal(codeOfThrown(outcome.thrown), "EIO");
                assert.equal(textOf(files, "/b.txt"), "ab");
            },
        },
    },
    {
        name: "making a symbolic link",
        effect: "link",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.symlink("/a.txt", "/link"),
        failures: makeLinkChecks,
    },
    {
        name: "making a hard link",
        effect: "link",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.link("/a.txt", "/b.txt"),
        failures: {
            ...makeLinkChecks,
            "hard-link-across-filesystems": "EXDEV",
        },
    },
    {
        name: "reading a link",
        effect: "link",
        occurrence: 0,
        setup: (files) => files.symlink("/a.txt", "/link"),
        act: (files) => files.readLink("/link"),
        failures: {
            "read-a-link-that-is-not-a-link": "EINVAL",
            "read-a-link-that-is-missing": "ENOENT",
        },
    },
    {
        name: "resolving a path",
        effect: "resolve-path",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.realPath("/a.txt"),
        failures: {
            "path-not-found": "ENOENT",
            "not-a-directory": "ENOTDIR",
            "access-denied": "EACCES",
            "symlink-loop": "ELOOP",
            "name-too-long": "ENAMETOOLONG",
        },
    },
    {
        name: "changing a path's permissions",
        effect: "attributes",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.changeAttributes("/a.txt", true, "chmod", (entry) => {
            entry.mode = 0o600;
        }),
        failures: attributeChecks,
    },
    {
        name: "changing an open file's permissions",
        effect: "attributes",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/a.txt", "abc");
            files.openFile("/a.txt", "r", 0o666);
        },
        act: (files) => files.changeOpenAttributes(3, "fchmod", (entry) => {
            entry.mode = 0o600;
        }),
        failures: {
            "access-denied": "EACCES",
            "not-permitted": "EPERM",
            "input-or-output-error": "EIO",
            "read-only-filesystem": "EROFS",
        },
    },
    {
        name: "setting a file's length",
        effect: "file-state",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.truncate("/a.txt", 1),
        failures: {
            "resize-past-the-size-limit": "EFBIG",
        },
    },
    {
        name: "setting an open file's length",
        effect: "file-state",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/a.txt", "abc");
            files.openFile("/a.txt", "r+", 0o666);
        },
        act: (files) => files.truncateOpen(3, 1),
        failures: {
            "resize-past-the-size-limit": "EFBIG",
        },
    },
    {
        name: "reading what an open file is",
        effect: "file-state",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/a.txt", "abc");
            files.openFile("/a.txt", "r", 0o666);
        },
        act: (files) => files.statOpen(3),
        failures: {
            "length-cannot-be-read": "EIO",
        },
    },
    {
        name: "writing an open file through to the disk",
        effect: "file-state",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/a.txt", "abc");
            files.openFile("/a.txt", "r", 0o666);
        },
        act: (files) => files.syncOpen(3, "fsync"),
        failures: {
            "sync-fails": "EIO",
            "sync-out-of-space": "ENOSPC",
        },
    },
    {
        name: "opening a file to read",
        effect: "file-open",
        occurrence: 0,
        setup: (files) => seedFile(files, "/a.txt", "abc"),
        act: (files) => files.openFile("/a.txt", "r", 0o666),
        failures: openToReadChecks,
    },
    {
        name: "opening a file to write",
        effect: "file-open",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.openFile("/a.txt", "w", 0o666),
        failures: openToWriteChecks,
    },
    {
        name: "opening a file to create it exclusively",
        effect: "file-open",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.openFile("/a.txt", "wx", 0o666),
        failures: {
            ...openToWriteChecks,
            "already-exists": "EEXIST",
        },
    },
    {
        name: "reading an open file",
        effect: "read",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/a.txt", "abcdefgh");
            files.openFile("/a.txt", "r", 0o666);
        },
        act: (files) => {
            const into = Buffer.alloc(8);
            const read = files.readOpen(3, into, 0, 8, undefined);
            return into.subarray(0, read).toString("utf8");
        },
        failures: {
            "input-or-output-error": "EIO",
            "short-read": (outcome) => {
                assert.equal(outcome.answer, "abcd");
            },
            "read-of-a-directory": "EISDIR",
        },
    },
    {
        name: "writing an open file",
        effect: "write",
        occurrence: 0,
        setup: (files) => {
            files.openFile("/a.txt", "w", 0o666);
        },
        act: (files) => files.writeOpen(3, Buffer.from("abcdefgh"), undefined),
        failures: {
            "out-of-space": "ENOSPC",
            "input-or-output-error": "EIO",
            "short-write": (outcome, files) => {
                assert.equal(outcome.answer, 4);
                assert.equal(files.kindAt("/a.txt"), "file");
            },
            "quota-exceeded": "EDQUOT",
            "read-only-filesystem": "EROFS",
        },
    },
    {
        name: "writing one byte to an open file, which cannot be written short",
        effect: "write",
        occurrence: 0,
        setup: (files) => {
            files.openFile("/a.txt", "w", 0o666);
        },
        act: (files) => files.writeOpen(3, Buffer.from("a"), undefined),
        failures: writeWholeChecks,
    },
    {
        name: "reading an open file for a stream",
        effect: "read",
        occurrence: 0,
        setup: (files) => {
            seedFile(files, "/a.txt", "abcdefgh");
            files.openFile("/a.txt", "r", 0o666);
        },
        act: (files) => files.readForStream(3, 0, undefined).toString("utf8"),
        failures: {
            "input-or-output-error": "EIO",
            "early-end-of-stream": (outcome) => {
                assert.equal(outcome.answer, "abcd");
            },
            "read-of-a-directory": "EISDIR",
        },
    },
    {
        name: "reading the working directory",
        effect: "current-directory",
        occurrence: 0,
        setup: () => undefined,
        act: (files) => files.cwd(),
        failures: {
            "current-directory-was-deleted": "ENOENT",
        },
    },
    {
        name: "changing the working directory",
        effect: "current-directory",
        occurrence: 0,
        setup: (files) => files.makeDirectory("/d", false, 0o777),
        act: (files) => files.chdir("/d"),
        failures: {
            "change-to-a-missing-directory": "ENOENT",
        },
    },
];

describe("every failure at every place", () => {
    for (const failureCase of failureCases) {
        test(`${failureCase.name}: the place lists exactly the failures checked here`, () => {
            const { files, injector } = preparedTree(undefined, failureCase.setup);
            const outcome = outcomeOf(() => failureCase.act(files));
            assert.equal(outcome.thrown, undefined, `With no failure planned the operation threw ${String(outcome.thrown)}.`);
            const reached = injector.reached.find((one) => one.place.effect === failureCase.effect && one.place.occurrence === failureCase.occurrence);
            assert.ok(reached !== undefined, `The operation reached no place ${failureCase.effect}#${failureCase.occurrence}.`);
            assert.deepEqual([...reached.failures].sort(), Object.keys(failureCase.failures).sort());
        });

        for (const [failure, check] of Object.entries(failureCase.failures)) {
            test(`${failureCase.name}: ${failure}`, () => {
                const { files, injector } = preparedTree({
                    place: {
                        effect: failureCase.effect,
                        occurrence: failureCase.occurrence,
                    },
                    failure,
                }, failureCase.setup);
                const outcome = outcomeOf(() => failureCase.act(files));
                assert.equal(injector.injected, true);
                if (typeof check === "string") {
                    assert.equal(codeOfThrown(outcome.thrown), check, `The operation answered ${String(outcome.answer)} and threw ${String(outcome.thrown)}.`);
                    return;
                }
                check(outcome, files);
            });
        }
    }
});

describe("the tree", () => {
    // A tree with no failure planned.
    function emptyTree(): RunFiles {
        return treeWith(new Injector(undefined));
    }

    test("the tree starts holding only the root", () => {
        const files = emptyTree();
        assert.deepEqual(files.listDirectory("/", false), []);
        assert.equal(files.exists("/"), true);
        assert.equal(files.exists("/etc/passwd"), false);
    });

    test("what is written is read back, and an append adds to the end", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("one"), false, false);
        files.writeFile("/a.txt", Buffer.from(" two"), true, false);
        assert.equal(textOf(files, "/a.txt"), "one two");
        files.writeFile("/a.txt", Buffer.from("new"), false, false);
        assert.equal(textOf(files, "/a.txt"), "new");
    });

    test("a read hands back a copy, so changing it changes no file", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("abc"), false, false);
        files.readFile("/a.txt")[0] = 0;
        assert.equal(textOf(files, "/a.txt"), "abc");
    });

    test("a write into a directory that is not there fails as Linux fails", () => {
        const files = emptyTree();
        assert.throws(() => files.writeFile("/missing/a.txt", Buffer.from("x"), false, false), { code: "ENOENT" });
        files.writeFile("/file", Buffer.from("x"), false, false);
        assert.throws(() => files.writeFile("/file/a.txt", Buffer.from("x"), false, false), { code: "ENOTDIR" });
        assert.throws(() => files.readFile("/file/a.txt"), { code: "ENOTDIR" });
    });

    test("an exclusive write to a file that is there fails, and a write to a directory fails", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("x"), false, false);
        assert.throws(() => files.writeFile("/a.txt", Buffer.from("x"), false, true), { code: "EEXIST" });
        files.makeDirectory("/d", false, 0o777);
        assert.throws(() => files.writeFile("/d", Buffer.from("x"), false, false), { code: "EISDIR" });
        assert.throws(() => files.readFile("/d"), { code: "EISDIR" });
    });

    test("a name longer than Linux takes fails with ENAMETOOLONG", () => {
        assert.throws(() => emptyTree().readFile(`/${"n".repeat(256)}`), { code: "ENAMETOOLONG" });
    });

    test("a listing comes back sorted whatever order the entries were made in", () => {
        const files = emptyTree();
        for (const name of ["zebra", "apple", "Mango", "banana"]) {
            files.writeFile(`/${name}`, Buffer.from(name), false, false);
        }
        files.makeDirectory("/cherry", false, 0o777);
        assert.deepEqual(files.listDirectory("/", false), ["/Mango", "/apple", "/banana", "/cherry", "/zebra"]);
    });

    test("a recursive listing lists each directory's sorted entries before the next directory's", () => {
        const files = emptyTree();
        files.makeDirectory("/r/b/c", true, 0o777);
        files.makeDirectory("/r/a", true, 0o777);
        files.writeFile("/r/z.txt", Buffer.from("z"), false, false);
        files.writeFile("/r/b/y.txt", Buffer.from("y"), false, false);
        assert.deepEqual(files.listDirectory("/r", true), ["/r/a", "/r/b", "/r/z.txt", "/r/b/c", "/r/b/y.txt"]);
    });

    test("listing a path that is not a directory fails as Linux fails", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("x"), false, false);
        assert.throws(() => files.listDirectory("/a.txt", false), { code: "ENOTDIR" });
        assert.throws(() => files.listDirectory("/missing", false), { code: "ENOENT" });
    });

    test("a directory opened to read entry by entry lists its entries sorted and does not fail", () => {
        const files = emptyTree();
        files.writeFile("/b", Buffer.from(""), false, false);
        files.writeFile("/a", Buffer.from(""), false, false);
        assert.deepEqual(files.openDirectory("/"), {
            paths: ["/a", "/b"],
            failsAfter: undefined,
        });
    });

    test("a relative path is read from the working directory", () => {
        const files = emptyTree();
        files.makeDirectory("/work", false, 0o777);
        files.chdir("/work");
        files.writeFile("notes.txt", Buffer.from("kept"), false, false);
        assert.equal(files.cwd(), "/work");
        assert.equal(textOf(files, "/work/notes.txt"), "kept");
        assert.equal(textOf(files, "./notes.txt"), "kept");
        assert.equal(textOf(files, "/work/./notes.txt"), "kept");
        assert.equal(files.absolute("../x"), "/x");
    });

    test("changing to a directory that is not there or is not a directory fails as Linux fails", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("x"), false, false);
        assert.throws(() => files.chdir("/missing"), { code: "ENOENT" });
        assert.throws(() => files.chdir("/a.txt"), { code: "ENOTDIR" });
    });

    test("a recursive make makes every missing directory and hands back the first it made", () => {
        const files = emptyTree();
        files.makeDirectory("/a", false, 0o777);
        assert.equal(files.makeDirectory("/a/b/c", true, 0o777), "/a/b");
        assert.equal(files.makeDirectory("/a/b/c", true, 0o777), undefined);
        assert.equal(files.kindAt("/a/b/c"), "directory");
    });

    test("making a directory where one is, or under a file, fails as Linux fails", () => {
        const files = emptyTree();
        files.makeDirectory("/a", false, 0o777);
        assert.throws(() => files.makeDirectory("/a", false, 0o777), { code: "EEXIST" });
        assert.throws(() => files.makeDirectory("/x/y", false, 0o777), { code: "ENOENT" });
        files.writeFile("/f", Buffer.from("x"), false, false);
        assert.throws(() => files.makeDirectory("/f", true, 0o777), { code: "EEXIST" });
        assert.throws(() => files.makeDirectory("/f/g", true, 0o777), { code: "ENOTDIR" });
    });

    test("a temporary directory's name is drawn from the seed, so the same seed makes the same name", () => {
        const first = emptyTree().makeTemporaryDirectory("/tmp-");
        const second = emptyTree().makeTemporaryDirectory("/tmp-");
        assert.equal(first, second);
        assert.match(first, /^\/tmp-[A-Za-z0-9]{6}$/);
    });

    test("removing takes a file away, and a directory only as the call allows", () => {
        const files = emptyTree();
        files.makeDirectory("/d/e", true, 0o777);
        files.writeFile("/d/e/f.txt", Buffer.from("x"), false, false);
        assert.throws(() => files.unlink("/d"), { code: "EISDIR" });
        assert.throws(() => files.unlink("/missing"), { code: "ENOENT" });
        assert.throws(() => files.removeDirectory("/d"), { code: "ENOTEMPTY" });
        assert.throws(() => files.removeDirectory("/d/e/f.txt"), { code: "ENOTDIR" });
        assert.throws(() => files.removeDirectory("/missing"), { code: "ENOENT" });
        assert.throws(() => files.remove("/d", false, false), { code: "EISDIR" });
        assert.throws(() => files.remove("/missing", false, false), { code: "ENOENT" });
        files.remove("/missing", true, true);
        files.unlink("/d/e/f.txt");
        files.removeDirectory("/d/e");
        files.writeFile("/d/g.txt", Buffer.from("x"), false, false);
        files.remove("/d/g.txt", false, false);
        files.remove("/d", true, false);
        assert.deepEqual(files.listDirectory("/", false), []);
    });

    test("removing a tree of one entry that fails part way through fails after deleting it", () => {
        const injector = new Injector({
            place: { effect: "delete", occurrence: 0 },
            failure: "error-part-way-through-deleting-a-tree",
        });
        const files = treeWith(injector);
        injector.setInjecting(false);
        files.makeDirectory("/d", false, 0o777);
        injector.setInjecting(true);
        assert.throws(() => files.remove("/d", true, false), { code: "EIO" });
        assert.equal(files.kindAt("/d"), undefined);
    });

    test("a rename moves a file, a directory and everything under it", () => {
        const files = emptyTree();
        files.makeDirectory("/a/b", true, 0o777);
        files.writeFile("/a/b/c.txt", Buffer.from("deep"), false, false);
        files.rename("/a", "/z");
        assert.equal(textOf(files, "/z/b/c.txt"), "deep");
        assert.equal(files.exists("/a"), false);
        files.writeFile("/old", Buffer.from("new contents"), false, false);
        files.writeFile("/target", Buffer.from("replaced"), false, false);
        files.rename("/old", "/target");
        assert.equal(textOf(files, "/target"), "new contents");
    });

    test("a rename fails as Linux fails", () => {
        const files = emptyTree();
        files.makeDirectory("/full/inside", true, 0o777);
        files.makeDirectory("/empty", false, 0o777);
        files.writeFile("/file", Buffer.from("x"), false, false);
        assert.throws(() => files.rename("/missing", "/x"), { code: "ENOENT" });
        assert.throws(() => files.rename("/file", "/empty"), { code: "EISDIR" });
        assert.throws(() => files.rename("/empty", "/full"), { code: "ENOTEMPTY" });
        assert.throws(() => files.rename("/full", "/full/inside/deeper"), { code: "EINVAL" });
        assert.throws(() => files.rename("/file", "/missing/x"), { code: "ENOENT" });
        files.rename("/empty", "/full/inside");
        assert.equal(files.kindAt("/empty"), undefined);
    });

    test("a copy copies the bytes, and an exclusive one or one onto a directory fails", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("abc"), false, false);
        files.copyFile("/a.txt", "/b.txt", false);
        files.writeFile("/a.txt", Buffer.from("changed"), false, false);
        assert.equal(textOf(files, "/b.txt"), "abc");
        assert.throws(() => files.copyFile("/a.txt", "/b.txt", true), { code: "EEXIST" });
        files.makeDirectory("/d", false, 0o777);
        assert.throws(() => files.copyFile("/a.txt", "/d", false), { code: "EISDIR" });
        assert.throws(() => files.copyFile("/d", "/e", false), { code: "EISDIR" });
        assert.throws(() => files.copyFile("/missing", "/e", false), { code: "ENOENT" });
    });

    test("a tree copy copies a directory and everything under it, and only when asked to", () => {
        const files = emptyTree();
        files.makeDirectory("/src/inner", true, 0o777);
        files.writeFile("/src/inner/a.txt", Buffer.from("a"), false, false);
        files.writeFile("/src/b.txt", Buffer.from("b"), false, false);
        assert.throws(() => files.copyTree("/src", "/dst", false), { code: "EISDIR" });
        files.copyTree("/src", "/dst", true);
        assert.equal(textOf(files, "/dst/inner/a.txt"), "a");
        assert.equal(textOf(files, "/dst/b.txt"), "b");
        files.copyTree("/src/b.txt", "/single.txt", false);
        assert.equal(textOf(files, "/single.txt"), "b");
    });

    test("a symbolic link is followed whether its target is absolute or relative, and read as written", () => {
        const files = emptyTree();
        files.makeDirectory("/data/real", true, 0o777);
        files.writeFile("/data/real/file.txt", Buffer.from("through the link"), false, false);
        files.symlink("/data/real", "/absolute");
        files.symlink("real/file.txt", "/data/relative");
        files.symlink("../real", "/data/real/up");
        files.symlink("./real/./file.txt", "/data/dotted");
        assert.equal(textOf(files, "/absolute/file.txt"), "through the link");
        assert.equal(textOf(files, "/data/relative"), "through the link");
        assert.equal(textOf(files, "/data/dotted"), "through the link");
        assert.equal(textOf(files, "/data/real/up/file.txt"), "through the link");
        assert.equal(files.readLink("/data/relative"), "real/file.txt");
        assert.equal(files.realPath("/absolute/file.txt"), "/data/real/file.txt");
        assert.equal(files.stat("/absolute", false).entry!.kind, "symlink");
        assert.equal(files.stat("/absolute", true).entry!.kind, "directory");
    });

    test("a link to nothing fails to open with ENOENT and a loop of links with ELOOP", () => {
        const files = emptyTree();
        files.symlink("/nowhere", "/dangling");
        files.symlink("/loop-b", "/loop-a");
        files.symlink("/loop-a", "/loop-b");
        assert.throws(() => files.readFile("/dangling"), { code: "ENOENT" });
        assert.throws(() => files.readFile("/loop-a"), { code: "ELOOP" });
        assert.throws(() => files.realPath("/dangling"), { code: "ENOENT" });
        assert.equal(files.exists("/dangling"), false);
        assert.equal(files.stat("/dangling", false).entry!.kind, "symlink");
    });

    test("making a link over a path that is there, and reading a link that is not one, fail as Linux fails", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("x"), false, false);
        assert.throws(() => files.symlink("/x", "/a.txt"), { code: "EEXIST" });
        assert.throws(() => files.symlink("/x", "/missing/link"), { code: "ENOENT" });
        assert.throws(() => files.readLink("/a.txt"), { code: "EINVAL" });
        assert.throws(() => files.readLink("/missing"), { code: "ENOENT" });
    });

    test("removing a link takes the link away and leaves what it points at", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("kept"), false, false);
        files.symlink("/a.txt", "/link");
        files.unlink("/link");
        assert.equal(textOf(files, "/a.txt"), "kept");
        assert.equal(files.kindAt("/link"), undefined);
    });

    test("a hard link is one file at two paths", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("one"), false, false);
        files.link("/a.txt", "/b.txt");
        files.writeFile("/b.txt", Buffer.from("both"), false, false);
        assert.equal(textOf(files, "/a.txt"), "both");
        assert.equal(files.linkCount(files.stat("/a.txt", true).entry!), 2);
        files.unlink("/a.txt");
        assert.equal(textOf(files, "/b.txt"), "both");
        files.makeDirectory("/d", false, 0o777);
        assert.throws(() => files.link("/d", "/e"), { code: "EPERM" });
        assert.throws(() => files.link("/missing", "/e"), { code: "ENOENT" });
        assert.throws(() => files.link("/b.txt", "/d"), { code: "EEXIST" });
    });

    test("permissions, owner and times are changed on the entry a path names", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("x"), false, false);
        files.changeAttributes("/a.txt", true, "chmod", (entry) => {
            entry.mode = 0o600;
        });
        assert.equal(files.stat("/a.txt", true).entry!.mode, 0o600);
        assert.throws(() => files.changeAttributes("/missing", true, "chmod", () => undefined), { code: "ENOENT" });
    });

    test("a length cuts a file short or fills it with zero bytes", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("abcdef"), false, false);
        files.truncate("/a.txt", 2);
        assert.equal(textOf(files, "/a.txt"), "ab");
        files.truncate("/a.txt", 4);
        assert.deepEqual([...files.readFile("/a.txt")], [97, 98, 0, 0]);
        assert.throws(() => files.truncate("/missing", 0), { code: "ENOENT" });
        files.makeDirectory("/d", false, 0o777);
        assert.throws(() => files.truncate("/d", 0), { code: "EISDIR" });
    });

    test("an open file is read and written from where the last call ended, or where it was told", () => {
        const files = emptyTree();
        const number = files.openFile("/a.txt", "w+", 0o666);
        assert.equal(files.writeOpen(number, Buffer.from("hello"), undefined), 5);
        assert.equal(files.writeOpen(number, Buffer.from("J"), 0), 1);
        const into = Buffer.alloc(5);
        assert.equal(files.readOpen(number, into, 0, 5, 0), 5);
        assert.equal(into.toString("utf8"), "Jello");
        assert.equal(files.readOpen(number, into, 0, 5, undefined), 0);
        files.truncateOpen(number, 2);
        files.syncOpen(number, "fsync");
        assert.equal(files.statOpen(number).entry!.bytes.length, 2);
        assert.equal(files.openedPath(number), "/a.txt");
        files.closeOpen(number);
        assert.throws(() => files.closeOpen(number), { code: "EBADF" });
        assert.throws(() => files.readOpen(number, into, 0, 1, undefined), { code: "EBADF" });
    });

    test("a file opened to append writes at its end, and one opened to write starts empty", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("start"), false, false);
        const appending = files.openFile("/a.txt", "a", 0o666);
        files.writeOpen(appending, Buffer.from(" end"), 0);
        assert.equal(textOf(files, "/a.txt"), "start end");
        files.openFile("/a.txt", "w", 0o666);
        assert.equal(textOf(files, "/a.txt"), "");
    });

    test("a file opened for one of reading or writing refuses the other", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("x"), false, false);
        const reading = files.openFile("/a.txt", "r", 0o666);
        const writing = files.openFile("/a.txt", "a", 0o666);
        assert.throws(() => files.writeOpen(reading, Buffer.from("y"), undefined), { code: "EBADF" });
        assert.throws(() => files.readOpen(writing, Buffer.alloc(1), 0, 1, undefined), { code: "EBADF" });
    });

    test("opening fails as Linux fails", () => {
        const files = emptyTree();
        assert.throws(() => files.openFile("/missing", "r", 0o666), { code: "ENOENT" });
        files.makeDirectory("/d", false, 0o777);
        assert.throws(() => files.openFile("/d", "r+", 0o666), { code: "EISDIR" });
        const directory = files.openFile("/d", "r", 0o666);
        assert.throws(() => files.readOpen(directory, Buffer.alloc(1), 0, 1, undefined), { code: "EISDIR" });
        assert.throws(() => files.readForStream(directory, 0, undefined), { code: "EISDIR" });
        files.writeFile("/a.txt", Buffer.from("x"), false, false);
        assert.throws(() => files.openFile("/a.txt", "wx", 0o666), { code: "EEXIST" });
    });

    test("a stream reads the bytes from its start to its end, inclusive", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("abcdef"), false, false);
        const number = files.openFile("/a.txt", "r", 0o666);
        assert.equal(files.readForStream(number, 1, 3).toString("utf8"), "bcd");
        assert.equal(files.readForStream(number, 2, undefined).toString("utf8"), "cdef");
    });

    test("what a path is says whether a link was followed on the way", () => {
        const files = emptyTree();
        files.writeFile("/a.txt", Buffer.from("x"), false, false);
        files.symlink("/a.txt", "/link");
        assert.equal(files.find("/link", true, "stat").followedLink, true);
        assert.equal(files.find("/a.txt", true, "stat").followedLink, false);
        assert.equal(files.find("/missing", true, "stat").entry, undefined);
        assert.throws(() => files.stat("/missing", true), { code: "ENOENT" });
    });
});
