// Types and constants, and no function at all.

// What a measurement is.
export interface Measurement {
    // How wide.
    width: number;

    // How tall.
    height: number;
}

// The largest a measurement is allowed to be, which is what the code beside it checks against.
export const biggest = 4096;
