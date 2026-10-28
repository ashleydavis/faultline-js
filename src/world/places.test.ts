// Checks that a place is named by its effect and how many calls of that effect came before it.
//
// A counter numbers the calls of each effect on its own, and the names it gives are the ones a
// replay token carries.

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { isSamePlace, PlaceCounter, placeName } from "./places.ts";

test("a place is written as its effect and its occurrence", () => {
    assert.equal(placeName({
        effect: "file-open",
        occurrence: 3,
    }), "file-open#3");
});

test("two places are the same only when both the effect and the occurrence are", () => {
    assert.equal(isSamePlace({ effect: "read", occurrence: 1 }, { effect: "read", occurrence: 1 }), true);
    assert.equal(isSamePlace({ effect: "read", occurrence: 1 }, { effect: "read", occurrence: 2 }), false);
    assert.equal(isSamePlace({ effect: "read", occurrence: 1 }, { effect: "write", occurrence: 1 }), false);
});

test("each effect's calls are numbered from zero and apart from every other effect's", () => {
    const counter = new PlaceCounter();
    assert.deepEqual(
        [counter.next("read"), counter.next("write"), counter.next("read"), counter.next("read"), counter.next("write")],
        [
            { effect: "read", occurrence: 0 },
            { effect: "write", occurrence: 0 },
            { effect: "read", occurrence: 1 },
            { effect: "read", occurrence: 2 },
            { effect: "write", occurrence: 1 },
        ],
    );
});
