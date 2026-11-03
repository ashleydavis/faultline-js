// What the copy imports in place of `node:crypto`.
//
// The random parts are drawn from the run's seeded generator, so a replay draws the same bytes.
// `randomBytes` given a callback can fail as `docs/FAILURES.md` lists. The work with a callback that
// Node runs on its thread pool (`scrypt`, `pbkdf2`, `hkdf`, `generateKeyPair`, `generatePrime` and
// `checkPrime`) is the real thing and can fail as `docs/FAILURES.md` lists, because the callback is
// where the code reads an error the work met. Hashing, ciphers and the rest are the real thing: they
// read no randomness and reach nothing outside the process.

import realCrypto from "node:crypto";
import { nowRunning } from "../current.ts";

// Everything the real module has and this one does not replace. A name declared here wins over the
// one the star brings in.
export * from "node:crypto";

// Fills `into` with bytes from the run's generator.
function fillWith(into: ArrayBufferView, offset: number, size: number): void {
    const running = nowRunning()!;
    new Uint8Array(into.buffer, into.byteOffset + offset, size).set(running.rng.bytes(size));
}

export function randomBytes(size: number, callback?: unknown): Buffer | undefined {
    const running = nowRunning();
    if (running === undefined) {
        return (realCrypto.randomBytes as (...args: unknown[]) => Buffer | undefined)(size, callback);
    }
    if (typeof callback !== "function") {
        return Buffer.from(running.rng.bytes(size));
    }
    const failure = running.injector.check("random", ["no-entropy-available"]);
    const done = callback as (error: Error | null, bytes?: Buffer) => void;
    if (failure !== undefined) {
        queueMicrotask(() => done(new Error("No entropy is available to draw random bytes from.")));
        return undefined;
    }
    const bytes = Buffer.from(running.rng.bytes(size));
    queueMicrotask(() => done(null, bytes));
    return undefined;
}

// Hands `name` its arguments with no run in flight, and with a run in flight is a place that can fail
// instead, passing the callback (the last argument) an `Error`.
function doWork(name: string, args: unknown[]): void {
    const real = (realCrypto as unknown as Record<string, (...given: unknown[]) => void>)[name];
    const running = nowRunning();
    if (running === undefined) {
        real(...args);
        return;
    }
    const failure = running.injector.check("crypto-work", ["crypto-work-fails"]);
    if (failure !== undefined) {
        const done = args[args.length - 1] as (error: Error) => void;
        queueMicrotask(() => done(new Error(`The ${name} work failed.`)));
        return;
    }
    real(...args);
}

export function scrypt(...args: unknown[]): void {
    doWork("scrypt", args);
}

export function pbkdf2(...args: unknown[]): void {
    doWork("pbkdf2", args);
}

export function hkdf(...args: unknown[]): void {
    doWork("hkdf", args);
}

export function generateKeyPair(...args: unknown[]): void {
    doWork("generateKeyPair", args);
}

export function generatePrime(...args: unknown[]): void {
    doWork("generatePrime", args);
}

export function checkPrime(...args: unknown[]): void {
    doWork("checkPrime", args);
}

// Each replacement of the work carries the symbols Node puts on the real function, such as the one
// that makes `util.promisify(generateKeyPair)` resolve with both keys and not with the first alone.
for (const [name, replacement] of Object.entries({ scrypt, pbkdf2, hkdf, generateKeyPair, generatePrime, checkPrime })) {
    const real = (realCrypto as unknown as Record<string, object>)[name];
    for (const symbol of Object.getOwnPropertySymbols(real)) {
        Object.defineProperty(replacement, symbol, Object.getOwnPropertyDescriptor(real, symbol)!);
    }
}

export function randomUUID(): string {
    return nowRunning()?.rng.uuid() ?? realCrypto.randomUUID();
}

// A whole number from `low` up to but not including `high`, or from zero when given one bound.
export function randomInt(first: number, second?: unknown, callback?: unknown): number | undefined {
    const running = nowRunning();
    if (running === undefined) {
        return (realCrypto.randomInt as (...args: unknown[]) => number | undefined)(first, second, callback);
    }
    const hasLow = typeof second === "number";
    const low = hasLow ? first : 0;
    const high = hasLow ? (second as number) : first;
    const drawn = running.rng.int(low, high - 1);
    const done = hasLow ? callback : second;
    if (typeof done === "function") {
        queueMicrotask(() => (done as (error: Error | null, value: number) => void)(null, drawn));
        return undefined;
    }
    return drawn;
}

export function getRandomValues<T extends ArrayBufferView>(into: T): T {
    if (nowRunning() === undefined) {
        return realCrypto.getRandomValues(into as never) as T;
    }
    fillWith(into, 0, into.byteLength);
    return into;
}

export function randomFillSync<T extends ArrayBufferView>(into: T, offset?: number, size?: number): T {
    if (nowRunning() === undefined) {
        return realCrypto.randomFillSync(into as never, offset, size) as T;
    }
    const start = offset ?? 0;
    fillWith(into, start, size ?? into.byteLength - start);
    return into;
}

export function randomFill(into: ArrayBufferView, ...args: unknown[]): void {
    if (nowRunning() === undefined) {
        (realCrypto.randomFill as (...given: unknown[]) => void)(into, ...args);
        return;
    }
    const done = args.pop() as (error: Error | null, filled: ArrayBufferView) => void;
    const offset = typeof args[0] === "number" ? args[0] : 0;
    const size = typeof args[1] === "number" ? args[1] : into.byteLength - offset;
    fillWith(into, offset, size);
    queueMicrotask(() => done(null, into));
}

// What `import crypto from "node:crypto"` gets.
export default {
    ...realCrypto,
    randomBytes,
    randomUUID,
    randomInt,
    getRandomValues,
    randomFillSync,
    randomFill,
    scrypt,
    pbkdf2,
    hkdf,
    generateKeyPair,
    generatePrime,
    checkPrime,
};
