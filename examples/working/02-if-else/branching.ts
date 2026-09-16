// Both sides of an `if`, and an `if` whose false side is not written out.

// An `if` with an `else` written out.
export function classify(count: number): string {
    if (count === 0) {
        return "none";
    }
    else {
        return "some";
    }
}

// An `if` with no `else`. The false side is still a path, and still counted.
export function doubleWhenSmall(value: number): number {
    if (value < 100) {
        return value * 2;
    }
    return value;
}

// A chain, where each arm is the false side of the one above it.
export function band(value: number): string {
    if (value < 0) {
        return "under";
    }
    else if (value < 10) {
        return "low";
    }
    return "high";
}
