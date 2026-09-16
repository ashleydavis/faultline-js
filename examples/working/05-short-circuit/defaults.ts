// The two paths every short circuiting operator has.

// The right side runs only when the left is truthy.
export function bothSet(left: string, right: string): boolean {
    return left.length > 0 && right.length > 0;
}

// The right side runs only when the left is null or undefined.
export function orElse(given: string | undefined): string {
    return given ?? "the default";
}
