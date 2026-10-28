// Checks the functions Faultline passes in: each call is a place, a planned failure makes it throw
// or reject, and with no run in flight it only returns its value.
//
// Each test puts a run in flight with `runWith`, calls a built function and reads what the run's
// injector wrote down, then takes the run away again.

import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import { runWith } from "../world/current.ts";
import type { PlannedFailure } from "../world/injector.ts";
import { RunSubject } from "../world/subject.ts";
import { passedInFailures, passedInFunction } from "./passed-in.ts";

afterEach(() => {
    runWith(undefined);
});

// A run in flight with the plan given.
function inFlight(planned: PlannedFailure | undefined): RunSubject {
    const subject = new RunSubject(1, planned);
    runWith(subject);
    return subject;
}

// What a built function returns with no failure: the number 7.
const returnsSeven = {
    build: (): unknown => 7,
};

test("a function that returns a promise can throw or reject, any other only throw", () => {
    assert.deepEqual(passedInFailures(true), ["throws", "rejects"]);
    assert.deepEqual(passedInFailures(false), ["throws"]);
});

test("with no run in flight the function returns its value", () => {
    assert.equal(passedInFunction(false, returnsSeven)(), 7);
});

test("each call is a place, written down with the failures possible there", () => {
    const subject = inFlight(undefined);
    const passed = passedInFunction(true, returnsSeven);
    assert.equal(passed(), 7);
    assert.equal(passed(), 7);
    assert.deepEqual(subject.injector.reached, [
        {
            place: {
                effect: "function-passed-in",
                occurrence: 0,
            },
            failures: ["throws", "rejects"],
        },
        {
            place: {
                effect: "function-passed-in",
                occurrence: 1,
            },
            failures: ["throws", "rejects"],
        },
    ]);
});

test("a planned throw makes the call at that place throw and no other", () => {
    const subject = inFlight({
        place: {
            effect: "function-passed-in",
            occurrence: 1,
        },
        failure: "throws",
    });
    const passed = passedInFunction(false, returnsSeven);
    assert.equal(passed(), 7);
    assert.throws(() => passed(), /threw, because the run injected that failure/);
    assert.equal(passed(), 7);
    assert.equal(subject.injector.injected, true);
});

test("a planned rejection makes the call return a promise that rejects", async () => {
    inFlight({
        place: {
            effect: "function-passed-in",
            occurrence: 0,
        },
        failure: "rejects",
    });
    const passed = passedInFunction(true, returnsSeven);
    const returned = passed();
    assert.ok(returned instanceof Promise);
    await assert.rejects(returned, /rejected, because the run injected that failure/);
});

test("a function that returns no promise is never planned to reject", () => {
    const subject = inFlight({
        place: {
            effect: "function-passed-in",
            occurrence: 0,
        },
        failure: "rejects",
    });
    assert.equal(passedInFunction(false, returnsSeven)(), 7);
    assert.equal(subject.injector.injected, false);
});

test("the value is built afresh on every call", () => {
    let built = 0;
    const passed = passedInFunction(false, {
        build: (): unknown => {
            built += 1;
            return built;
        },
    });
    assert.equal(passed(), 1);
    assert.equal(passed(), 2);
});
