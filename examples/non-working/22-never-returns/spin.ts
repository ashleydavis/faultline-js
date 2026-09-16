// A loop with no end, which the run stops at the budget rather than hanging for good.

export function spin(go: boolean): number {
    let count = 0;
    while (go) {
        count += 1;
    }
    return count;
}
