//
// Checks the failure table in code: every effect has one group, ids are unique and in kebab case
// and an effect's failures are its group's rows.
//
// The method is to read the table through the functions that look it up. That the table matches
// `docs/FAILURES.md` row for row is checked by `src/smoke/failure-table.smoke.ts`, because reading
// the document reads the repository.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { failureGroups, failureIdsOf, isFailureOf, type Effect } from "./failures.ts";

describe("failureGroups", () => {
    test("every effect has one group", () => {
        const effects = failureGroups.map((group) => group.effect);
        assert.equal(new Set(effects).size, effects.length);
    });

    test("failure ids are unique within a group and every one is written in kebab case", () => {
        for (const group of failureGroups) {
            const ids = group.kinds.map((kind) => kind.id);
            assert.equal(new Set(ids).size, ids.length, group.heading);
            for (const id of ids) {
                assert.match(id, /^[a-z]+(-[a-z]+)*$/);
            }
        }
    });
});

describe("failureIdsOf", () => {
    test("an effect's failure ids are its group's, in the table's order", () => {
        assert.deepEqual(failureIdsOf("clock"), ["time-goes-backwards", "time-stands-still", "time-jumps-far-forward"]);
    });

    test("an effect with no group is a mistake in the tool and is refused", () => {
        //
        // The point is a name that is not an `Effect`, which the type rules out, so no guard can
        // produce one and the test has to cast.
        //
        assert.throws(() => failureIdsOf("made-up" as Effect), /no group for the effect "made-up"/);
    });
});

describe("isFailureOf", () => {
    test("a failure belongs to an effect only when it is one of that effect's rows", () => {
        assert.equal(isFailureOf("network", "connection-refused"), true);
        assert.equal(isFailureOf("clock", "connection-refused"), false);
    });
});
