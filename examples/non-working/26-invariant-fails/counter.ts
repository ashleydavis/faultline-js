// A counter that lets itself go below zero, which the invariant beside it says it may not.

// What has been counted so far.
let held = 0;

// Takes an amount off, without checking what is left. It refuses an amount that is not a number
// at all, so one bad call does not stop every call after it from counting.
export function takeOff(amount: number): number {
    if (!Number.isFinite(amount) || amount < 0) {
        return held;
    }
    held -= amount;
    return held;
}

// What is left.
export function left(): number {
    return held;
}
