// Tests for the replacement of `node:fs/promises`.
//
// The goal is to show that this module is the promise half of the replaced `node:fs`, so code that
// uses both reads and writes one tree. The method is to put a run in flight, write through this
// module and read back through the replaced `node:fs`.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { runWith } from "../current.ts";
import { RunSubject } from "../subject.ts";
import files from "./fs.ts";
import promised, { readFile, writeFile } from "./fs-promises.ts";

test("the module and its default are the promise half of the replaced node:fs", () => {
    assert.equal(promised, files.promises);
    assert.equal(readFile, files.promises.readFile);
});

test("what is written through this module is read back through node:fs", async () => {
    const subject = new RunSubject(1, undefined);
    const before = runWith(subject);
    try {
        await writeFile("/shared.txt", "one tree");
        assert.equal(files.readFileSync("/shared.txt", "utf8"), "one tree");
    }
    finally {
        runWith(before);
    }
});
