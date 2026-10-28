// Checks the simulated environment variables.
//
// Variables are set, read, listed and taken away, with no failure planned and with each failure
// planned at a read.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { RunEnvironment } from "./environment.ts";
import { Injector } from "./injector.ts";

test("the environment starts empty", () => {
    const environment = new RunEnvironment(new Injector(undefined));
    assert.equal(environment.read("HOME"), undefined);
    assert.deepEqual(environment.names(), []);
});

test("a variable set is read back as text and listed", () => {
    const environment = new RunEnvironment(new Injector(undefined));
    environment.set("PORT", 8080);
    assert.equal(environment.read("PORT"), "8080");
    assert.equal(environment.has("PORT"), true);
    assert.deepEqual(environment.names(), ["PORT"]);
    environment.unset("PORT");
    assert.equal(environment.has("PORT"), false);
});

test("every read is a place, and asking whether a variable is set is not", () => {
    const injector = new Injector(undefined);
    const environment = new RunEnvironment(injector);
    environment.has("A");
    environment.read("A");
    assert.deepEqual(injector.reached, [
        { place: { effect: "environment", occurrence: 0 }, failures: ["variable-not-set", "variable-set-to-an-empty-value"] },
    ]);
});

test("a variable that is not set reads as undefined", () => {
    const environment = new RunEnvironment(new Injector({
        place: { effect: "environment", occurrence: 0 },
        failure: "variable-not-set",
    }));
    environment.set("TOKEN", "secret");
    assert.equal(environment.read("TOKEN"), undefined);
});

test("a variable set to an empty value reads as an empty string", () => {
    const environment = new RunEnvironment(new Injector({
        place: { effect: "environment", occurrence: 0 },
        failure: "variable-set-to-an-empty-value",
    }));
    environment.set("TOKEN", "secret");
    assert.equal(environment.read("TOKEN"), "");
});
