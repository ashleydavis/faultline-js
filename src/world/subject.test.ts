// Checks that a subject wires every effect of one run to one seed and one planned failure.
//
// Each test builds a subject, calls the effects it carries, and reads back what they answered or
// wrote down.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { ProcessExitCalled, RunSubject } from "./subject.ts";

test("every effect of a subject asks the one injector", () => {
    const subject = new RunSubject(1, undefined);
    subject.clock.now();
    subject.files.cwd();
    subject.environment.read("HOME");
    subject.stdout.write("x");
    assert.deepEqual(subject.injector.reached.map((reached) => reached.place.effect), ["clock", "current-directory", "environment", "standard-stream"]);
});

test("the planned failure reaches the effect at its place", () => {
    const subject = new RunSubject(1, {
        place: { effect: "environment", occurrence: 0 },
        failure: "variable-set-to-an-empty-value",
    });
    subject.environment.set("NAME", "value");
    assert.equal(subject.environment.read("NAME"), "");
    assert.equal(subject.environment.read("NAME"), "value");
});

test("two subjects on one seed draw the same values and name the same temporary directories", () => {
    const left = new RunSubject(5, undefined);
    const right = new RunSubject(5, undefined);
    assert.equal(left.rng.next(), right.rng.next());
    assert.equal(left.files.makeTemporaryDirectory("/t-"), right.files.makeTemporaryDirectory("/t-"));
});

test("what console writes is kept on the run's output and error without a place", () => {
    const subject = new RunSubject(1, undefined);
    subject.console.log("logged", 1);
    subject.console.error("complained");
    assert.equal(subject.stdout.written(), "logged 1\n");
    assert.equal(subject.stderr.written(), "complained\n");
    assert.deepEqual(subject.injector.reached, []);
});

test("asking to exit hands back what stops the call there, carrying the code", () => {
    const subject = new RunSubject(1, undefined);
    const stop = subject.exit(3);
    assert.ok(stop instanceof ProcessExitCalled);
    assert.equal(stop.exitCode, 3);
    assert.match(stop.message, /process\.exit\(3\)/);
});

test("a run starts with process.exitCode unset, whatever the run before it set", () => {
    process.exitCode = 1;
    const subject = new RunSubject(1, undefined);
    const cleared = process.exitCode;
    process.exitCode = 2;
    const exit = subject.exit(undefined).exitCode;
    process.exitCode = undefined;
    assert.equal(cleared, undefined);
    assert.equal(exit, 2);
});

test("asking to exit with no code exits with zero, as Node does", () => {
    const subject = new RunSubject(1, undefined);
    assert.equal(subject.exit(undefined).exitCode, 0);
});
