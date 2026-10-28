// What the copy imports in place of `node:timers/promises`.
//
// A wait set while a run is in flight waits on the run's clock, so `await setTimeout(1000)` is over
// as soon as the run loop moves the clock on to it. A wait given an aborted signal fails as Node's
// fails.

import realTimers from "node:timers/promises";
import { nowRunning } from "../current.ts";
import { abortError } from "../effects.ts";
import { clearRunTimer, setRunTimer } from "../globals.ts";

// Everything the real module has and this one does not replace. A name declared here wins over the
// one the star brings in.
export * from "node:timers/promises";

// The signal a wait was given in its options.
function signalOf(options: unknown): AbortSignal | undefined {
    if (options === null || typeof options !== "object") {
        return undefined;
    }
    return (options as { signal?: AbortSignal }).signal;
}

export function setTimeout<T>(delayMs?: unknown, value?: T, options?: unknown): Promise<T> {
    if (nowRunning() === undefined) {
        return (realTimers.setTimeout as (...given: unknown[]) => Promise<T>)(delayMs, value, options);
    }
    const signal = signalOf(options);
    return new Promise<T>((settle, refuse) => {
        if (signal?.aborted === true) {
            refuse(abortError());
            return;
        }
        const timer = setRunTimer(() => settle(value as T), delayMs, [], false);
        signal?.addEventListener("abort", () => {
            clearRunTimer(timer);
            refuse(abortError());
        }, {
            once: true,
        });
    });
}

export function setImmediate<T>(value?: T, options?: unknown): Promise<T> {
    return (realTimers.setImmediate as (...given: unknown[]) => Promise<T>)(value, options);
}

// A wait that hands over `value` every `delayMs`, as `for await (const tick of setInterval(1000))`
// reads it. Each turn waits on the run's clock.
export async function* setInterval<T>(delayMs?: unknown, value?: T, options?: unknown): AsyncGenerator<T> {
    if (nowRunning() === undefined) {
        yield* (realTimers.setInterval as (...given: unknown[]) => AsyncIterable<T>)(delayMs, value, options);
    }
    else {
        while (true) {
            yield await setTimeout(delayMs, value as T, options);
        }
    }
}

// The scheduler, whose `wait` is `setTimeout` without a value.
export const scheduler = {
    wait: (delayMs: unknown, options?: unknown): Promise<void> => setTimeout(delayMs, undefined, options),
    yield: (): Promise<void> => setImmediate(undefined),
};

// What `import timers from "node:timers/promises"` gets.
export default {
    ...realTimers,
    setTimeout,
    setImmediate,
    setInterval,
    scheduler,
};
