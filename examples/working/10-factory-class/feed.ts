// A branch per answer, reached by one factory that hands back a different answer each time.

// What a reading is.
export interface Reading {
    // The value read.
    value: number;
}

// Which band a reading falls in.
export function bandOf(reading: Reading): string {
    if (reading.value < 0) {
        return "under";
    }
    if (reading.value > 100) {
        return "over";
    }
    return "inside";
}
