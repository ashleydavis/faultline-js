// The code this example measures.

export function highest(values: number[]): number {
    let best = Number.NEGATIVE_INFINITY;
    for (const value of values) {
        if (value > best) {
            best = value;
        }
    }
    return best;
}
