import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { callSite, placeIn, siteIn, withoutPrefix } from "./site.ts";

test("a frame with a name for it is read out of the brackets", () => {
    assert.equal(placeIn("    at readAll (/tmp/work/reads.ts:5:21)"), "/tmp/work/reads.ts:5:21");
});

test("a frame with no name for it is the whole of what follows", () => {
    assert.equal(placeIn("    at /tmp/work/reads.ts:5:21"), "/tmp/work/reads.ts:5:21");
});

test("a frame the runtime marked as awaited is read the same as any other", () => {
    assert.equal(placeIn("    at async /tmp/work/reads.ts:5:21"), "/tmp/work/reads.ts:5:21");
});

test("the first line of a stack is the message rather than a frame", () => {
    assert.equal(placeIn("Error: site"), undefined);
});

test("the frame the tool went through on its way to the effect is stepped over", () => {
    const stack = [
        "Error: site",
        "    at RunInjector.check (file:///tool/effects/injector.ts:139:51)",
        "    at RunFiles.read (file:///tool/effects/effects.ts:149:14)",
        "    at readAll (/tmp/work/reads.ts:6:21)",
    ].join("\n");
    assert.equal(siteIn(stack, "file:///tool/"), "/tmp/work/reads.ts:6:21");
});

test("a frame inside the runtime itself is stepped over", () => {
    const stack = [
        "Error: site",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
        "    at readAll (/tmp/work/reads.ts:6:21)",
    ].join("\n");
    assert.equal(siteIn(stack, "file:///tool/"), "/tmp/work/reads.ts:6:21");
});

test("a stack with no frame outside the tool names no site", () => {
    assert.equal(siteIn("Error: site\n    at f (file:///tool/a.ts:1:1)", "file:///tool/"), "");
});

test("a call from outside the tool is named with its own line and column", async () => {
    // Called from a file the tool does not hold, which is where the code under test is.
    const where = fs.mkdtempSync(path.join(os.tmpdir(), "faultline-site-"));
    const caller = path.join(where, "caller.mjs");
    fs.writeFileSync(caller, `import { callSite } from "${pathToFileURL(path.resolve("src/effects/site.ts")).href}";\nexport const first = callSite();\nexport const second = callSite();\n`);
    try {
        const held = await import(pathToFileURL(caller).href) as { first: string; second: string };
        assert.ok(held.first.includes("caller.mjs"), held.first);
        assert.notEqual(held.first, held.second);
    }
    finally {
        fs.rmSync(where, { recursive: true, force: true });
    }
});

test("a place is named by the path in the project rather than the directory the copies sit in", () => {
    assert.equal(withoutPrefix("/tmp/faultline-abc/reads.ts:6:21", "/tmp/faultline-abc"), "reads.ts:6:21");
});

test("a place the runtime named with a file url has the same directory taken off it", () => {
    assert.equal(withoutPrefix("file:///tmp/faultline-abc/reads.ts:6:21", "/tmp/faultline-abc"), "reads.ts:6:21");
});

test("a place outside that directory is left as it is", () => {
    assert.equal(withoutPrefix("/elsewhere/reads.ts:6:21", "/tmp/faultline-abc"), "/elsewhere/reads.ts:6:21");
});

test("a run that named no directory leaves every place as it is", () => {
    assert.equal(withoutPrefix("/tmp/reads.ts:6:21", ""), "/tmp/reads.ts:6:21");
});
