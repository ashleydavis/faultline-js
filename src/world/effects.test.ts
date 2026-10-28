// Checks that the simulated effects fail with the errors Node fails with.
//
// The errors are built and read back, and every row of the failure table that says a call "fails
// with" a code is checked to fail with exactly that code.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { abortError, CodedError, codeOf, fileError, hasCode, networkError } from "./effects.ts";
import { failureGroups } from "./failures.ts";

test("every row that says a call fails with a code fails with that code", () => {
    for (const group of failureGroups) {
        for (const kind of group.kinds) {
            const written = /^fails with `([A-Z_]+)`( when creating exclusively)?$/.exec(kind.outcome);
            if (written === null) {
                continue;
            }
            assert.equal(hasCode(kind.id), true, `${group.heading}: ${kind.description}`);
            assert.equal(codeOf(kind.id), written[1], `${group.heading}: ${kind.description}`);
        }
    }
});

test("a failure carried out some other way has no code, and asking for one is refused", () => {
    assert.equal(hasCode("short-read"), false);
    assert.throws(() => codeOf("short-read"), /fails with no code/);
});

test("a coded error carries what Node puts on a failed system call", () => {
    const error = new CodedError("ENOENT", "gone", "open", "/a", "/b");
    assert.ok(error instanceof Error);
    assert.equal(error.name, "Error");
    assert.equal(error.code, "ENOENT");
    assert.equal(error.errno, -2);
    assert.equal(error.syscall, "open");
    assert.equal(error.path, "/a");
    assert.equal(error.dest, "/b");
});

test("a code Node gives no number has none", () => {
    assert.equal(new CodedError("ENOTFOUND", "gone").errno, undefined);
});

test("a filesystem error is worded as Node words it", () => {
    assert.equal(fileError("ENOENT", "open", "/missing").message, "ENOENT: no such file or directory, open '/missing'");
    assert.equal(fileError("EXDEV", "rename", "/a", "/b").message, "EXDEV: cross-device link not permitted, rename '/a' -> '/b'");
    assert.equal(fileError("EWHAT", "open", "/a").message, "EWHAT: ewhat, open '/a'");
});

test("a network error is worded as Node words it", () => {
    const error = networkError("ECONNREFUSED", "connect", "example.com:80");
    assert.equal(error.message, "connect ECONNREFUSED example.com:80");
    assert.equal(error.syscall, "connect");
    assert.equal(error.errno, -111);
});

test("an aborted call fails with the name and code Node gives it", () => {
    const error = abortError() as Error & { code?: string };
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, "ABORT_ERR");
});
