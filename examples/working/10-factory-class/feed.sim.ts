// One factory walking a sequence of its own, which is what a method on a class is for.

import type { Reading } from "./feed.ts";

export class Readings {
    // How many have been handed out, which is what walks the list below.
    private handed = 0;

    // One reading per band, so every branch that reads one is reached.
    private static readonly values = [-1, 50, 500];

    // The next reading in the sequence.
    next(): Reading {
        const value = Readings.values[this.handed % Readings.values.length]!;
        this.handed += 1;
        return { value };
    }
}
