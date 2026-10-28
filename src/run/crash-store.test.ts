//
// Checks the kept crashes: where the file is, reading it (missing, blank lines, an unreadable
// file), adding the crashes a run found without adding one twice, when two tokens name the same call
// (the seed counts only when a value was drawn from it), which failures are kept and writing the
// file. Files are read and written in a file system in memory, which is also made to fail.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { createFakeFileSystem } from "../lib/fake-files.test.ts";
import { callWithoutSeed, crashStorePath, crashTokens, hasSeededValue, isAmong, isCrashKept, isSameCall, messageOf, readCrashes, tokensOf, withNew, writeCrashes } from "./crash-store.ts";
import type { IFailure, FailureKind } from "./judge.ts";
import { readToken } from "./token.ts";

//
// A failure of `kind` found by the call `token`.
//
export function failureOf(kind: FailureKind, token: string): IFailure {
    return {
        kind,
        message: "m.",
        location: "",
        key: `${kind}|${token}`,
        token,
        stack: "",
    };
}

describe("crashStorePath", () => {
    test("the crashes sit in Faultline's cache directory in the project", () => {
        assert.equal(crashStorePath("/project"), "/project/node_modules/.cache/faultline/crashes.txt");
    });
});

describe("readCrashes", () => {
    test("a missing file holds no crashes", async () => {
        assert.deepEqual(await readCrashes(createFakeFileSystem({}), "/project/none.txt"), {
            ok: true,
            value: [],
        });
    });

    test("a file that cannot be read is an error with a sentence, not an empty store", async () => {
        const files = createFakeFileSystem({
            "/project/crashes.txt": "src/a.ts:f;seed=1\n",
        });
        files.failNext("/project/crashes.txt", "EACCES");
        const read = await readCrashes(files, "/project/crashes.txt");
        assert(!read.ok);
        assert.match(read.error, /^Faultline could not read the kept crashes in \/project\/crashes\.txt: EACCES.*\. Make the file readable, or delete it to throw the kept crashes away\.$/);
    });

    test("a failure that carries no code is an error with its message, not an empty store", async () => {
        const files = createFakeFileSystem({});
        files.readText = () => Promise.reject(new Error("The disk went away"));
        const read = await readCrashes(files, "/project/crashes.txt");
        assert(!read.ok);
        assert.equal(read.error, "Faultline could not read the kept crashes in /project/crashes.txt: The disk went away. Make the file readable, or delete it to throw the kept crashes away.");
    });
});

describe("writeCrashes", () => {
    test("what is written is read back in order, and the directory is made", async () => {
        const files = createFakeFileSystem({});
        const file = "/project/deep/er/crashes.txt";
        await writeCrashes(files, file, ["src/a.ts:f;seed=1", "src/b.ts:g;seed=2;values=b0"]);
        assert.equal(files.directories.has("/project/deep/er"), true);
        assert.equal(files.files.get(file), "src/a.ts:f;seed=1\nsrc/b.ts:g;seed=2;values=b0\n");
        assert.deepEqual(await readCrashes(files, file), {
            ok: true,
            value: ["src/a.ts:f;seed=1", "src/b.ts:g;seed=2;values=b0"],
        });
    });

    test("an empty token is refused before anything is written", async () => {
        const files = createFakeFileSystem({});
        await assert.rejects(writeCrashes(files, "/project/bad.txt", [""]));
        assert.equal(files.files.has("/project/bad.txt"), false);
    });

    test("a token with a line break in it is refused before anything is written", async () => {
        const files = createFakeFileSystem({});
        await assert.rejects(writeCrashes(files, "/project/bad.txt", ["a\nb"]));
        assert.equal(files.files.has("/project/bad.txt"), false);
    });
});

describe("tokensOf", () => {
    test("one token per line that is not blank, with the spaces around it taken off", () => {
        assert.deepEqual(tokensOf("  a  \n\n\tb\r\n   \n"), ["a", "b"]);
        assert.deepEqual(tokensOf(""), []);
    });
});

describe("isSameCall", () => {
    test("the same text is the same call", () => {
        assert.equal(isSameCall("not a token", "not a token"), true);
    });

    test("tokens that differ only in the seed are the same call, unless a value was drawn from the seed", () => {
        assert.equal(isSameCall("src/a.ts:f;seed=1;values=b0;fail=read#0/short-read", "src/a.ts:f;seed=9;values=b0;fail=read#0/short-read"), true);
        assert.equal(isSameCall("src/a.ts:f;seed=1;values=s0", "src/a.ts:f;seed=9;values=s0"), false);
        assert.equal(isSameCall("src/a.ts:f;seed=1;values=b0", "src/a.ts:f;seed=9;values=s0"), false);
    });

    test("another function, value or failure is another call", () => {
        assert.equal(isSameCall("src/a.ts:f;seed=1", "src/a.ts:g;seed=1"), false);
        assert.equal(isSameCall("src/a.ts:f;seed=1;values=b0", "src/a.ts:f;seed=1;values=b1"), false);
        assert.equal(isSameCall("src/a.ts:f;seed=1;fail=read#0/short-read", "src/a.ts:f;seed=1;fail=read#1/short-read"), false);
        assert.equal(isSameCall("src/a.ts:f;seed=1", "src/a.ts:f;seed=1;fail=read#0/short-read"), false);
    });

    test("a token that cannot be read is the same call only as the same text", () => {
        assert.equal(isSameCall("src/a.ts:f;seed=1", "src/a.ts:f;seed=x"), false);
        assert.equal(isSameCall("bad", "src/a.ts:f;seed=1"), false);
    });
});

describe("hasSeededValue", () => {
    test("a seeded choice is found, and a token with no values has none", () => {
        const seeded = readToken("src/a.ts:f;seed=4;values=b0,s2;fail=read#0/short-read");
        assert(seeded.ok);
        assert.equal(hasSeededValue(seeded.value), true);
        const unseeded = readToken("src/a.ts:f;seed=4");
        assert(unseeded.ok);
        assert.equal(hasSeededValue(unseeded.value), false);
    });
});

describe("callWithoutSeed", () => {
    test("the seed is left out of the call, and the parts with nothing in them stay empty", () => {
        const seeded = readToken("src/a.ts:f;seed=4;values=b0,s2;fail=read#0/short-read");
        assert(seeded.ok);
        assert.equal(callWithoutSeed(seeded.value), "src/a.ts:f;b0,s2;read#0/short-read");
        const unseeded = readToken("src/a.ts:f;seed=4");
        assert(unseeded.ok);
        assert.equal(callWithoutSeed(unseeded.value), "src/a.ts:f;;");
    });
});

describe("withNew", () => {
    test("kept tokens stay first and a crash found again with a new seed is not added", () => {
        const kept = ["src/a.ts:f;seed=1;values=b0"];
        const found = ["src/a.ts:f;seed=2;values=b0", "src/b.ts:g;seed=2", "src/b.ts:g;seed=3"];
        assert.deepEqual(withNew(kept, found), ["src/a.ts:f;seed=1;values=b0", "src/b.ts:g;seed=2"]);
        assert.deepEqual(withNew([], []), []);
    });
});

describe("isAmong", () => {
    test("a token is among the kept ones when one of them names the same call", () => {
        const kept = ["src/a.ts:f;seed=1;values=b0"];
        assert.equal(isAmong(kept, "src/a.ts:f;seed=7;values=b0"), true);
        assert.equal(isAmong(kept, "src/a.ts:f;seed=7;values=b1"), false);
        assert.equal(isAmong([], "src/a.ts:f;seed=7"), false);
    });
});

describe("crashTokens", () => {
    test("crashes and errors no code caught are kept, and the other failures are not", () => {
        const failures = [
            failureOf("crash", "t1"),
            failureOf("hang", "t2"),
            failureOf("uncaught", "t3"),
            failureOf("expectation", "t5"),
        ];
        assert.deepEqual(crashTokens(failures), ["t1", "t3"]);
    });

    test("a shard that failed to open is not kept, because replaying it would open the file again", () => {
        const failedOpen: IFailure = {
            ...failureOf("crash", "t1"),
            key: "open|src/a.ts",
        };
        assert.deepEqual(crashTokens([failedOpen, failureOf("crash", "t2")]), ["t2"]);
    });
});

describe("isCrashKept", () => {
    test("a crash and an error no code caught are kept, and every other kind and a failed open are not", () => {
        assert.equal(isCrashKept(failureOf("crash", "t1")), true);
        assert.equal(isCrashKept(failureOf("uncaught", "t1")), true);
        assert.equal(isCrashKept(failureOf("hang", "t1")), false);
        assert.equal(isCrashKept(failureOf("expectation", "t1")), false);
        assert.equal(isCrashKept({
            ...failureOf("crash", "t1"),
            key: "open|src/a.ts",
        }), false);
    });
});

describe("messageOf", () => {
    test("an error gives its message and anything else is written out", () => {
        assert.equal(messageOf(new Error("gone")), "gone");
        assert.equal(messageOf("text thrown"), "text thrown");
        assert.equal(messageOf(undefined), "undefined");
    });
});
