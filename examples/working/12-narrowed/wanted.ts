// The one function the run was narrowed to.

export function wanted(value: number): string {
    if (value > 0) {
        return "positive";
    }
    return "not positive";
}

// Left out of the run, because it was narrowed to the function above.
export function alsoHere(value: number): number {
    if (value > 100) {
        return 100;
    }
    return value;
}
