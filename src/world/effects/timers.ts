// What the copy imports in place of `node:timers`.
//
// The timers here are the replaced globals, so a timer set through the module waits on the run's
// clock as one set through the global does. `setImmediate` is the real one: it waits for no time,
// so it runs in the same order on every run.

import { clearRunTimer, setRunTimer } from "../globals.ts";
import realTimers from "node:timers";

// Everything the real module has and this one does not replace. A name declared here wins over the
// one the star brings in.
export * from "node:timers";

export function setTimeout(work: unknown, delayMs?: unknown, ...args: unknown[]): unknown {
    return setRunTimer(work, delayMs, args, false) ?? (realTimers.setTimeout as (...given: unknown[]) => unknown)(work, delayMs, ...args);
}

export function setInterval(work: unknown, delayMs?: unknown, ...args: unknown[]): unknown {
    return setRunTimer(work, delayMs, args, true) ?? (realTimers.setInterval as (...given: unknown[]) => unknown)(work, delayMs, ...args);
}

export function clearTimeout(handle: unknown): void {
    if (!clearRunTimer(handle)) {
        realTimers.clearTimeout(handle as NodeJS.Timeout);
    }
}

export function clearInterval(handle: unknown): void {
    if (!clearRunTimer(handle)) {
        realTimers.clearInterval(handle as NodeJS.Timeout);
    }
}

// What `import timers from "node:timers"` gets.
export default {
    ...realTimers,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
};
