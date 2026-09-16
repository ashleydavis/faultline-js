// One path per loop body, whichever way the loop is written.

// Adds up a list, which is the ordinary loop.
export function total(items: number[]): number {
    let sum = 0;
    for (const item of items) {
        sum += item;
    }
    return sum;
}

// Counts down, which is the same path written the other way.
export function countdown(from: number): number {
    let steps = 0;
    while (steps < from && steps < 10) {
        steps += 1;
    }
    return steps;
}

// Walks the keys of an object.
export function keyCount(held: Record<string, number>): number {
    let seen = 0;
    for (const key in held) {
        seen += key.length;
    }
    return seen;
}
