import assert from "node:assert/strict";
import { test } from "@jest/globals";
import vm from "node:vm";
import { callSite, placeIn, siteIn, toolDirectoriesIn, withoutPrefix } from "./site.ts";

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
    assert.equal(siteIn(stack, ["file:///tool/"]), "/tmp/work/reads.ts:6:21");
});

test("a frame inside the runtime itself is stepped over", () => {
    const stack = [
        "Error: site",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
        "    at readAll (/tmp/work/reads.ts:6:21)",
    ].join("\n");
    assert.equal(siteIn(stack, ["file:///tool/"]), "/tmp/work/reads.ts:6:21");
});

test("a stack with no frame outside the tool names no site", () => {
    assert.equal(siteIn("Error: site\n    at f (file:///tool/a.ts:1:1)", ["file:///tool/"]), "");
});

test("a call from outside the tool is named with its own line and column", () => {
    // Called from a file the tool does not hold, which is where the code under test is.
    const calls = vm.runInThisContext("(callSite) => [\n    callSite(),\n    callSite(),\n]", {
        filename: "/project/caller.js",
    }) as (site: () => string) => string[];
    const [first, second] = calls(callSite);
    assert.ok(first.startsWith("/project/caller.js:2:"), first);
    assert.ok(second.startsWith("/project/caller.js:3:"), second);
});

test("the tool's directory is the one above the file the first frame is in, as a url and as a path", () => {
    const stack = "Error: site\n    at callSite (/tool/world/site.ts:25:19)\n    at readAll (/tmp/work/reads.ts:6:21)";
    assert.deepEqual(toolDirectoriesIn(stack), ["file:///tool/", "/tool/"]);
});

test("a first frame named by its file url gives the same directories", () => {
    const stack = "Error: site\n    at callSite (file:///tool/world/site.ts:25:19)";
    assert.deepEqual(toolDirectoriesIn(stack), ["file:///tool/", "/tool/"]);
});

test("a stack with no frame names no directory for the tool", () => {
    assert.deepEqual(toolDirectoriesIn("Error: site"), []);
    assert.deepEqual(toolDirectoriesIn(""), []);
});

test("a place is named by the path in the project rather than the directory the copies sit in", () => {
    assert.equal(withoutPrefix("/tmp/faultline-abc/reads.ts:6:21", "/tmp/faultline-abc"), "reads.ts:6:21");
});

test("a place the runtime named with a file url has the same directory taken off it", () => {
    assert.equal(withoutPrefix("file:///tmp/faultline-abc/reads.ts:6:21", "/tmp/faultline-abc"), "reads.ts:6:21");
});

test("a directory named with a slash on the end is taken off the same as one without", () => {
    assert.equal(withoutPrefix("/tmp/faultline-abc/reads.ts:6:21", "/tmp/faultline-abc/"), "reads.ts:6:21");
});

test("a call site read with the copies' directory named has that directory taken off it", () => {
    // Called from a file the tool does not hold, under a directory standing in for the copies.
    const calls = vm.runInThisContext("(callSite) => callSite('/copies')", {
        filename: "/copies/caller.js",
    }) as (site: (under: string) => string) => string;
    const where = calls(callSite);
    assert.ok(where.startsWith("caller.js:1:"), where);
});

test("a runtime that gives no stack names no site", () => {
    // The runtime takes whatever this hands back as the stack, so the stack is left undefined.
    const was = Error.prepareStackTrace;
    Error.prepareStackTrace = () => undefined;
    try {
        assert.equal(callSite(), "");
    }
    finally {
        Error.prepareStackTrace = was;
    }
});

test("a place outside that directory is left as it is", () => {
    assert.equal(withoutPrefix("/elsewhere/reads.ts:6:21", "/tmp/faultline-abc"), "/elsewhere/reads.ts:6:21");
});

test("a run that named no directory leaves every place as it is", () => {
    assert.equal(withoutPrefix("/tmp/reads.ts:6:21", ""), "/tmp/reads.ts:6:21");
});

test("a frame inside the tool named by its path rather than its file url is stepped over too", () => {
    const stack = [
        "Error: site",
        "    at check (/tool/world/injector.ts:139:51)",
        "    at readAll (/tmp/work/reads.ts:6:21)",
    ].join("\n");
    assert.equal(siteIn(stack, ["file:///tool/", "/tool/"]), "/tmp/work/reads.ts:6:21");
});
