// Tests for the replacement of `node:crypto`.
//
// The goal is to show that the random calls draw from the run's seed, so two runs of one seed draw
// the same, that `randomBytes` with a callback can fail as `docs/FAILURES.md` says and that with no
// run in flight they are handed to the real module. The real random calls are replaced here by
// stand-ins, so the test checks each is handed on with the same arguments and its answer handed
// back. The method is to make every random call twice from one seed with a run in flight and
// compare what came back, then to make them with no run in flight.

import assert from "node:assert/strict";
import realCrypto from "node:crypto";
import { describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import type { PlannedFailure } from "../injector.ts";
import { RunSubject } from "../subject.ts";
import crypto, { checkPrime, generateKeyPair, generatePrime, getRandomValues, hkdf, pbkdf2, randomBytes, randomFill, randomFillSync, randomInt, randomUUID, scrypt } from "./crypto.ts";

// The real module with every random call replaced by a stand-in that answers with a value naming
// itself.
jest.mock("node:crypto", () => ({
    ...jest.requireActual<typeof realCrypto>("node:crypto"),
    randomBytes: jest.fn(() => "real randomBytes"),
    randomUUID: jest.fn(() => "real randomUUID"),
    randomInt: jest.fn(() => "real randomInt"),
    getRandomValues: jest.fn(() => "real getRandomValues"),
    randomFillSync: jest.fn(() => "real randomFillSync"),
    randomFill: jest.fn(() => "real randomFill"),
    scrypt: jest.fn(() => "real scrypt"),
    pbkdf2: jest.fn(() => "real pbkdf2"),
    hkdf: jest.fn(() => "real hkdf"),
    generateKeyPair: Object.defineProperties(
        jest.fn(() => "real generateKeyPair"),
        Object.fromEntries(Object.getOwnPropertySymbols(jest.requireActual<typeof realCrypto>("node:crypto").generateKeyPair).map((symbol) => [
            symbol,
            Object.getOwnPropertyDescriptor(jest.requireActual<typeof realCrypto>("node:crypto").generateKeyPair, symbol)!,
        ])),
    ),
    generatePrime: jest.fn(() => "real generatePrime"),
    checkPrime: jest.fn(() => "real checkPrime"),
}));

// The stand-ins above, as the test reads them back.
const realModule = jest.requireMock<Record<string, jest.Mock>>("node:crypto");

// The arguments the stand-in `name` was last called with, copied out of the mock's own realm.
export function lastCall(name: string): unknown[] {
    return Array.from(realModule[name].mock.lastCall ?? []);
}

// A callback a call is handed, which nothing calls while the real module is stood in for.
export function ignoreAnswer(): void {
    return undefined;
}

// Runs `work` with one run in flight and waits for it. The run injects `planned`, or nothing when
// it is undefined.
export async function runInFlight<T>(work: (subject: RunSubject) => T | Promise<T>, planned: PlannedFailure | undefined): Promise<T> {
    const subject = new RunSubject(9, planned);
    const before = runWith(subject);
    try {
        return await work(subject);
    }
    finally {
        runWith(before);
    }
}

// Every random call a run answers, made once each.
export async function drawEach(): Promise<(string | number | number[] | undefined)[]> {
    const filledWhole = Buffer.alloc(2);
    await new Promise<void>((done) => {
        randomFill(filledWhole, () => done());
    });
    const filledFromOffset = Buffer.alloc(3);
    await new Promise<void>((done) => {
        randomFill(filledFromOffset, 1, () => done());
    });
    const filledLater = Buffer.alloc(4);
    await new Promise<void>((done) => {
        randomFill(filledLater, 1, 2, () => done());
    });
    const fromCallback = await new Promise<Buffer>((settle) => {
        randomBytes(3, (_error: Error | null, bytes: Buffer | undefined) => {
            assert.ok(bytes);
            settle(bytes);
        });
    });
    const intFromCallback = await new Promise<number>((settle) => {
        randomInt(5, 10, (_error: Error | null, value: number) => settle(value));
    });
    const drawnBytes = randomBytes(4);
    assert.ok(drawnBytes);
    return [
        [...drawnBytes],
        [...fromCallback],
        randomUUID(),
        randomInt(10),
        randomInt(5, 10),
        intFromCallback,
        [...getRandomValues(new Uint8Array(3))],
        [...randomFillSync(new Uint8Array(4), 1, 2)],
        [...randomFillSync(new Uint8Array(2))],
        [...filledLater],
        [...filledWhole],
        [...filledFromOffset],
    ];
}

describe("with a run in flight", () => {
    test("two runs of one seed draw the same values from every random call", async () => {
        assert.deepEqual(await runInFlight(drawEach, undefined), await runInFlight(drawEach, undefined));
    });

    test("a range is drawn from its low bound up to but not including its high bound", async () => {
        await runInFlight(() => {
            // Many more draws than the range has values, so a draw past either bound shows up.
            for (let index = 0; index < 50; index += 1) {
                const drawn = randomInt(3, 6);
                assert.ok(drawn !== undefined);
                assert.ok(drawn >= 3);
                assert.ok(drawn < 6);
            }
        }, undefined);
    });

    test("only randomBytes with a callback is a place and there it can fail", async () => {
        const reached = await runInFlight(async (subject) => {
            randomBytes(1);
            await new Promise<void>((done) => {
                randomBytes(1, () => done());
            });
            return subject.injector.reached;
        }, undefined);
        assert.deepEqual(reached, [
            {
                place: {
                    effect: "random",
                    occurrence: 0,
                },
                failures: ["no-entropy-available"],
            },
        ]);
        const [error] = await runInFlight(() => new Promise<unknown[]>((settle) => {
            randomBytes(1, (...given: unknown[]) => settle(given));
        }), {
            place: {
                effect: "random",
                occurrence: 0,
            },
            failure: "no-entropy-available",
        });
        assert.ok(error instanceof Error);
        assert.equal(error.message, "No entropy is available to draw random bytes from.");
    });
});

describe("work on the thread pool", () => {
    // Each function of the work, by the name the real module has it under.
    const work: [string, (...args: unknown[]) => void][] = [
        ["scrypt", scrypt],
        ["pbkdf2", pbkdf2],
        ["hkdf", hkdf],
        ["generateKeyPair", generateKeyPair],
        ["generatePrime", generatePrime],
        ["checkPrime", checkPrime],
    ];

    test("with a run in flight each is a place, hands the real call its arguments and can fail", async () => {
        for (const [name, call] of work) {
            const reached = await runInFlight((subject) => {
                call("argument", ignoreAnswer);
                return Promise.resolve(subject.injector.reached);
            }, undefined);
            assert.deepEqual(lastCall(name), ["argument", ignoreAnswer]);
            assert.deepEqual(reached, [
                {
                    place: {
                        effect: "crypto-work",
                        occurrence: 0,
                    },
                    failures: ["crypto-work-fails"],
                },
            ]);
            const [error] = await runInFlight(() => new Promise<unknown[]>((settle) => {
                call("argument", (...given: unknown[]) => settle(given));
            }), {
                place: {
                    effect: "crypto-work",
                    occurrence: 0,
                },
                failure: "crypto-work-fails",
            });
            assert.ok(error instanceof Error);
            assert.equal(error.message, `The ${name} work failed.`);
        }
    });

    test("each carries the symbols of the real function, so util.promisify of generateKeyPair names both keys", () => {
        for (const [name, call] of work) {
            assert.deepEqual(Object.getOwnPropertySymbols(call).map(String), Object.getOwnPropertySymbols(realModule[name]).map(String));
        }
        assert.ok(Object.getOwnPropertySymbols(generateKeyPair).map(String).includes("Symbol(customPromisifyArgs)"));
    });

    test("with no run in flight each is handed to the real module with its arguments and is in the default export", () => {
        for (const [name, call] of work) {
            call("argument", ignoreAnswer);
            assert.deepEqual(lastCall(name), ["argument", ignoreAnswer]);
            assert.equal((crypto as unknown as Record<string, unknown>)[name], call);
        }
    });
});

describe("with no run in flight", () => {
    test("every random call is handed to the real module with its arguments and its answer comes back", () => {
        const into = new Uint8Array(4);
        assert.equal(randomBytes(8, ignoreAnswer), "real randomBytes");
        assert.deepEqual(lastCall("randomBytes"), [8, ignoreAnswer]);
        assert.equal(randomUUID(), "real randomUUID");
        assert.deepEqual(lastCall("randomUUID"), []);
        assert.equal(randomInt(1, 5, ignoreAnswer), "real randomInt");
        assert.deepEqual(lastCall("randomInt"), [1, 5, ignoreAnswer]);
        assert.equal(getRandomValues(into), "real getRandomValues");
        assert.deepEqual(lastCall("getRandomValues"), [into]);
        assert.equal(randomFillSync(into, 1, 2), "real randomFillSync");
        assert.deepEqual(lastCall("randomFillSync"), [into, 1, 2]);
        assert.equal(randomFill(into, 1, 2, ignoreAnswer), undefined);
        assert.deepEqual(lastCall("randomFill"), [into, 1, 2, ignoreAnswer]);
        assert.equal(crypto.createHash, realCrypto.createHash);
    });
});
