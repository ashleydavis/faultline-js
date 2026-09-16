// The other tree this run measures.

export function evens(values: number[]): number {
    let found = 0;
    for (const value of values) {
        if (value % 2 === 0) {
            found += 1;
        }
    }
    return found;
}
