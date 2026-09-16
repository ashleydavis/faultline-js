// Two generic functions, one constrained and one not.

// Hands back the first item, or the fallback when there is none.
export function firstOf<T>(items: T[], fallback: T): T {
    if (items.length === 0) {
        return fallback;
    }
    return items[0]!;
}

// Counts how many of the items are longer than the shortest allowed.
export function longEnough<T extends { length: number }>(items: T[], shortest: number): number {
    let found = 0;
    for (const item of items) {
        if (item.length >= shortest) {
            found += 1;
        }
    }
    return found;
}
