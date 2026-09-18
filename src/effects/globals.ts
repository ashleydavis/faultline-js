// The globals a run replaces, so code that reads the clock, draws a random number or fetches over
// the network is exercised without declaring anything.
//
// Every replacement asks for the run in flight. When there is none the real one is called, so the
// tool's own clock and network are its own and a project loaded but not yet driven behaves.
//
// Nothing here is Node's or a browser's alone. A global a runtime does not have is left alone.

import { nowRunning } from "./current.ts";

// What was there before, kept so a replacement can fall through to it and so a run can put the
// runtime back as it found it.
interface Held {
    // Where the value sat.
    on: Record<string, unknown>;

    // What it was called.
    name: string;

    // What it was.
    was: unknown;
}

// Everything this process replaced, newest first, so putting it back is walking the list.
const replaced: Held[] = [];

// Puts `value` in place of `on[name]`, remembering what was there. A name the runtime does not have
// is left alone rather than added, because code that checks for a global before using it would
// otherwise take a path the real runtime never gives it.
function put(on: Record<string, unknown>, name: string, value: unknown): void {
    if (!(name in on)) {
        return;
    }
    replaced.push({ on, name, was: on[name] });
    on[name] = value;
}

// Replaces every global a run controls. Calling it twice replaces nothing the second time.
export function installGlobals(): void {
    if (replaced.length > 0) {
        return;
    }
    const global = globalThis as unknown as Record<string, unknown>;
    const realDate = Date;
    const realRandom = Math.random.bind(Math);
    const realFetch = typeof global.fetch === "function" ? (global.fetch as typeof fetch).bind(global) : undefined;

    // A clock the code under test reads through `new Date()` and `Date.now()`. Everything else a
    // date does is the real thing, so parsing, formatting and arithmetic are unchanged.
    class RunDate extends realDate {
        constructor(...args: unknown[]) {
            if (args.length === 0) {
                super(RunDate.now());
                return;
            }
            // @ts-expect-error The arguments are whatever the caller passed, and Date takes them.
            super(...args);
        }

        static override now(): number {
            return nowRunning()?.clock.now() ?? realDate.now();
        }
    }

    put(global, "Date", RunDate);
    Math.random = (): number => nowRunning()?.rng.next() ?? realRandom();
    replaced.push({ on: Math as unknown as Record<string, unknown>, name: "random", was: realRandom });

    if (realFetch !== undefined) {
        put(global, "fetch", (input: string | URL, init?: RequestInit): Promise<Response> => {
            const running = nowRunning();
            if (running === undefined) {
                return realFetch(input, init);
            }
            return running.net.fetch(input, init);
        });
    }

    const performanceOf = global.performance as { now?: () => number } | undefined;
    if (performanceOf?.now !== undefined) {
        const realNow = performanceOf.now.bind(performanceOf);
        put(performanceOf as unknown as Record<string, unknown>, "now", (): number => nowRunning()?.clock.monotonic() ?? realNow());
    }

    const cryptoOf = global.crypto as { randomUUID?: () => string; getRandomValues?: (into: Uint8Array) => Uint8Array } | undefined;
    if (cryptoOf?.randomUUID !== undefined) {
        const realUuid = cryptoOf.randomUUID.bind(cryptoOf);
        put(cryptoOf as unknown as Record<string, unknown>, "randomUUID", (): string => nowRunning()?.rng.uuid() ?? realUuid());
    }
    if (cryptoOf?.getRandomValues !== undefined) {
        const realValues = cryptoOf.getRandomValues.bind(cryptoOf);
        put(cryptoOf as unknown as Record<string, unknown>, "getRandomValues", (into: Uint8Array): Uint8Array => {
            const running = nowRunning();
            if (running === undefined) {
                return realValues(into);
            }
            into.set(running.rng.bytes(into.length));
            return into;
        });
    }
}

// Puts every global back as it was. A test uses it so one run's replacements do not reach the next.
export function removeGlobals(): void {
    for (const held of replaced.reverse()) {
        held.on[held.name] = held.was;
    }
    replaced.length = 0;
}
