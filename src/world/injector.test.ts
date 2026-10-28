// Checks that the injector gives every effect call its place, writes down what could fail there and
// hands out the one planned failure at the planned place only.
//
// Each test builds an injector with or without a plan, makes the effect calls a function would make,
// and reads back what each call was answered with and what was written down.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { Injector } from "./injector.ts";

test("a call planned with no failure fails nowhere and writes down every place it reached", () => {
    const injector = new Injector(undefined);
    assert.equal(injector.check("read", ["input-or-output-error"]), undefined);
    assert.equal(injector.check("clock", ["time-stands-still", "time-goes-backwards"]), undefined);
    assert.equal(injector.check("read", ["short-read"]), undefined);
    assert.deepEqual(injector.reached, [
        { place: { effect: "read", occurrence: 0 }, failures: ["input-or-output-error"] },
        { place: { effect: "clock", occurrence: 0 }, failures: ["time-stands-still", "time-goes-backwards"] },
        { place: { effect: "read", occurrence: 1 }, failures: ["short-read"] },
    ]);
    assert.equal(injector.injected, false);
});

test("the planned failure is handed out at the planned place and nowhere else", () => {
    const injector = new Injector({
        place: { effect: "read", occurrence: 1 },
        failure: "short-read",
    });
    assert.equal(injector.check("read", ["short-read"]), undefined);
    assert.equal(injector.injected, false);
    assert.equal(injector.check("read", ["short-read"]), "short-read");
    assert.equal(injector.injected, true);
    assert.equal(injector.check("read", ["short-read"]), undefined);
});

test("a place reached after the planned failure is still written down", () => {
    const injector = new Injector({
        place: { effect: "write", occurrence: 0 },
        failure: "out-of-space",
    });
    injector.check("write", ["out-of-space"]);
    injector.check("delete", ["file-not-found"]);
    assert.deepEqual(injector.reached.map((reached) => reached.place), [
        { effect: "write", occurrence: 0 },
        { effect: "delete", occurrence: 0 },
    ]);
});

test("a planned failure the call at its place cannot have is not handed out", () => {
    const injector = new Injector({
        place: { effect: "write", occurrence: 0 },
        failure: "short-write",
    });
    assert.equal(injector.check("write", ["out-of-space"]), undefined);
    assert.equal(injector.injected, false);
});

test("with injection off a call is not counted, not written down and never fails", () => {
    const injector = new Injector({
        place: { effect: "read", occurrence: 0 },
        failure: "short-read",
    });
    injector.setInjecting(false);
    assert.equal(injector.check("read", ["short-read"]), undefined);
    assert.deepEqual(injector.reached, []);
    injector.setInjecting(true);
    assert.equal(injector.check("read", ["short-read"]), "short-read");
});

test("a plan naming a failure its effect has no row for is refused", () => {
    assert.throws(() => new Injector({
        place: { effect: "clock", occurrence: 0 },
        failure: "short-read",
    }), /has no failure "short-read"/);
});

test("a plan naming a place before the first is refused", () => {
    assert.throws(() => new Injector({
        place: { effect: "clock", occurrence: -1 },
        failure: "time-stands-still",
    }));
});

test("an effect call that names no possible failure, or one its effect has no row for, is refused", () => {
    const injector = new Injector(undefined);
    assert.throws(() => injector.check("read", []), /named no failure/);
    assert.throws(() => injector.check("read", ["out-of-space"]), /has no failure "out-of-space"/);
});
