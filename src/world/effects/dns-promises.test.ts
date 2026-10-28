// Tests for the replacement of `node:dns/promises`.
//
// The goal is to show that this module is the promise half of the replaced `node:dns`.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import dns from "./dns.ts";
import promised, { lookup, resolve, resolve4, resolve6 } from "./dns-promises.ts";

test("the module and its default are the promise half of the replaced node:dns", () => {
    assert.equal(promised, dns.promises);
    assert.equal(lookup, dns.promises.lookup);
    assert.equal(resolve, dns.promises.resolve);
    assert.equal(resolve4, dns.promises.resolve4);
    assert.equal(resolve6, dns.promises.resolve6);
});
