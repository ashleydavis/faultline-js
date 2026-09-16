import assert from "node:assert/strict";
import test from "node:test";
import { functionKey } from "./protocol.ts";

test("a function is counted under its file and the name the report gives it", () => {
    assert.equal(functionKey("a/b.ts", "Store.read"), "a/b.ts#Store.read");
});

test("two functions with one name in different files are told apart", () => {
    assert.notEqual(functionKey("a.ts", "read"), functionKey("b.ts", "read"));
});
