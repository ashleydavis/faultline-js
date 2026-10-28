//
// Checks that a call written as a token reads back as the same call, that each part is left out
// when it has nothing in it, and that every kind of bad token is refused with the part that is
// wrong.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { effectNamed, failedToken, readFailure, readSeed, readToken, readValues, writeToken, type IFailureRead, type IReplayToken, type TokenResult } from "./token.ts";

//
// A call with every part filled in.
//
const fullCall: IReplayToken = {
    file: "src/format.ts",
    name: "Reader.parse",
    seed: 42,
    values: [
        {
            source: "boundary",
            index: 0,
        },
        {
            source: "factory",
            index: 2,
        },
    ],
    failure: {
        place: {
            effect: "file-open",
            occurrence: 1,
        },
        failure: "file-not-found",
    },
};

describe("writeToken", () => {
    test("writes every part of a call", () => {
        assert.equal(writeToken(fullCall), "src/format.ts:Reader.parse;seed=42;values=b0,f2;fail=file-open#1/file-not-found");
    });

    test("leaves out the values of a call with no parameters and the failure of a call with none", () => {
        assert.equal(writeToken({
            ...fullCall,
            values: [],
            failure: undefined,
        }), "src/format.ts:Reader.parse;seed=42");
    });
});

describe("readToken", () => {
    test("reads back every call it wrote", () => {
        const calls = [fullCall, { ...fullCall, values: [], failure: undefined }, { ...fullCall, file: "c:/drive/a.ts", seed: 4294967295 }];
        for (const call of calls) {
            assert.deepEqual(readToken(writeToken(call)), {
                ok: true,
                value: call,
            });
        }
    });

    test("refuses a token with no file or no function", () => {
        for (const text of ["seed=1", ":f;seed=1", "a.ts:;seed=1"]) {
            const read = readToken(text);
            assert.equal(read.ok, false);
            assert.equal(!read.ok && read.error.name, "no-function");
        }
    });

    test("refuses a token with no seed, a bad seed or a part it does not know", () => {
        assert.deepEqual(readToken("a.ts:f"), failedToken("bad-seed", "The token \"a.ts:f\" has no seed= part."));
        assert.equal(errorName(readToken("a.ts:f;seed=-1")), "bad-seed");
        assert.equal(errorName(readToken("a.ts:f;seed=1;seed=2")), "bad-part");
        assert.equal(errorName(readToken("a.ts:f;seed=1;colour=red")), "bad-part");
        assert.equal(errorName(readToken("a.ts:f;seed=1;")), "bad-part");
        assert.equal(errorName(readToken("a.ts:f;seed=1;values=b0;values=b1")), "bad-part");
        assert.equal(errorName(readToken("a.ts:f;seed=1;fail=clock#0/time-stands-still;fail=clock#1/time-stands-still")), "bad-part");
    });

    test("refuses bad values and bad failures with the part that is wrong", () => {
        assert.equal(errorName(readToken("a.ts:f;seed=1;values=b0,x1")), "bad-choice");
        assert.equal(errorName(readToken("a.ts:f;seed=1;fail=nonsense")), "bad-failure");
        assert.equal(errorName(readToken("a.ts:f;seed=1;fail=teleport#0/fails")), "unknown-effect");
        assert.equal(errorName(readToken("a.ts:f;seed=1;fail=clock#0/explodes")), "unknown-failure");
    });
});

describe("the parts", () => {
    test("a seed is a whole number that fits in thirty two bits", () => {
        assert.equal(readSeed("0"), 0);
        assert.equal(readSeed("4294967295"), 4294967295);
        assert.equal(readSeed("4294967296"), undefined);
        assert.equal(readSeed("07"), undefined);
        assert.equal(readSeed("1.5"), undefined);
    });

    test("values are choices separated by commas", () => {
        assert.deepEqual(readValues("b0,s3,c1"), [
            { source: "boundary", index: 0 },
            { source: "seeded", index: 3 },
            { source: "condition", index: 1 },
        ]);
        assert.equal(readValues(""), undefined);
    });

    test("a failure names an effect, an occurrence and one of that effect's failures", () => {
        assert.deepEqual(readFailure("network#2/connection-refused"), {
            ok: true,
            value: {
                place: {
                    effect: "network",
                    occurrence: 2,
                },
                failure: "connection-refused",
            },
        });
        assert.equal(errorName(readFailure("clock#99999999999999999999/time-stands-still")), "bad-failure");
    });

    test("an effect is named only when the failure table has its group", () => {
        assert.equal(effectNamed("clock"), "clock");
        assert.equal(effectNamed("teleport"), undefined);
    });
});

//
// The name of the error a read gave back, or undefined when it read.
//
function errorName(read: TokenResult | IFailureRead): string | undefined {
    if (read.ok) {
        return undefined;
    }
    return read.error.name;
}
