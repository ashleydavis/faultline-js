//
// A branch per unit, reached by one value factory that gives a different reading each time.
//

import assert from "node:assert/strict";

//
// One reading from a thermometer.
//
export interface IReading {
    //
    // The unit the value is in.
    //
    unit: string;

    //
    // The value read.
    //
    value: number;
}

//
// How much one degree of each known unit is, in degrees Celsius.
//
const DEGREE_SIZES = new Map<string, number>([
    ["celsius", 1],
    ["fahrenheit", 5 / 9],
]);

//
// Gives a reading in degrees Celsius, or NaN for a unit the map does not know.
//
export function inCelsius(reading: IReading): number {
    assert(typeof reading.unit === "string");
    const size = DEGREE_SIZES.get(reading.unit);
    if (size === undefined) {
        return Number.NaN;
    }
    if (size === 1) {
        return reading.value;
    }
    return (reading.value - 32) * size;
}
