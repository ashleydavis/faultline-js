// Checks the simulated standard input, output and error.
//
// Output is written and read back with no failure planned and with each failure planned at the
// write. Input is read with no failure planned and with each failure planned at its read.

import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "@jest/globals";
import { Injector } from "./injector.ts";
import { RunInput, RunOutput } from "./streams.ts";

// An output stream whose first write fails the way `failure` says.
function outputFailing(failure: string): RunOutput {
    return new RunOutput(new Injector({
        place: { effect: "standard-stream", occurrence: 0 },
        failure,
    }), 1);
}

test("what is written is kept and not shown", async () => {
    const output = new RunOutput(new Injector(undefined), 1);
    let calledBack = false;
    assert.equal(output.write("one ", () => {
        calledBack = true;
    }), true);
    assert.equal(output.write(Buffer.from("two"), "utf8", undefined), true);
    await Promise.resolve();
    assert.equal(output.written(), "one two");
    assert.equal(calledBack, true);
    assert.equal(output.isTTY, false);
    assert.equal(output.fd, 1);
    assert.equal(output.getColorDepth(), 1);
    assert.equal(output.hasColors(), false);
});

test("every write is a place", () => {
    const injector = new Injector(undefined);
    new RunOutput(injector, 2).write("x");
    assert.deepEqual(injector.reached, [
        { place: { effect: "standard-stream", occurrence: 0 }, failures: ["input-or-output-error", "output-closed", "short-write"] },
    ]);
});

test("what is kept without asking is not a place", () => {
    const injector = new Injector(undefined);
    const output = new RunOutput(injector, 1);
    output.keep("logged");
    assert.equal(output.written(), "logged");
    assert.deepEqual(injector.reached, []);
});

test("an input or output error is emitted on the stream with EIO and handed to the callback", async () => {
    const output = outputFailing("input-or-output-error");
    let handed: unknown;
    assert.equal(output.write("lost", (error: unknown) => {
        handed = error;
    }), false);
    const [error] = await once(output, "error");
    assert.equal((error as { code: string }).code, "EIO");
    assert.equal((handed as { code: string }).code, "EIO");
    assert.equal(output.written(), "");
});

test("an error on the error stream names the error stream", async () => {
    const output = new RunOutput(new Injector({
        place: { effect: "standard-stream", occurrence: 0 },
        failure: "input-or-output-error",
    }), 2);
    output.write("lost");
    const [error] = await once(output, "error");
    assert.equal((error as { path: string }).path, "stderr");
});

test("output that is closed is emitted on the stream with EPIPE", async () => {
    const output = outputFailing("output-closed");
    output.write("lost");
    const [error] = await once(output, "error");
    assert.equal((error as { code: string }).code, "EPIPE");
});

test("a short write keeps what was written, returns false and emits drain later", async () => {
    const output = outputFailing("short-write");
    assert.equal(output.write("held"), false);
    await once(output, "drain");
    assert.equal(output.written(), "held");
});

test("the input ends with no data", async () => {
    const input = new RunInput(new Injector(undefined));
    const pieces: unknown[] = [];
    input.on("data", (piece) => pieces.push(piece));
    await once(input, "end");
    assert.deepEqual(pieces, []);
    assert.equal(input.isTTY, false);
    assert.equal(input.fd, 0);
});

test("reading the input is one place however many times the stream reads", async () => {
    const injector = new Injector(undefined);
    const input = new RunInput(injector);
    input.resume();
    await once(input, "end");
    input.read();
    assert.deepEqual(injector.reached, [
        { place: { effect: "standard-stream", occurrence: 0 }, failures: ["input-closed", "input-or-output-error"] },
    ]);
});

test("input that is closed ends with no data", async () => {
    const input = new RunInput(new Injector({
        place: { effect: "standard-stream", occurrence: 0 },
        failure: "input-closed",
    }));
    input.resume();
    await once(input, "end");
});

test("an input error destroys the input with EIO", async () => {
    const input = new RunInput(new Injector({
        place: { effect: "standard-stream", occurrence: 0 },
        failure: "input-or-output-error",
    }));
    input.resume();
    const [error] = await once(input, "error");
    assert.equal((error as { code: string }).code, "EIO");
});
