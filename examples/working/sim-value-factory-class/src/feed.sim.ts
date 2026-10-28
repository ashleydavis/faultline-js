//
// One value factory walking a sequence of its own, which is what a method on a class is for.
//

import assert from "node:assert/strict";
import type { IReading } from "./feed.ts";

//
// One unit per branch, in the order the factory gives them, so every branch is reached.
//
const UNITS = ["celsius", "fahrenheit", "kelvin"];

//
// Gives the readings one after another.
//
export class Readings {
    //
    // How many readings have been given, which says which one comes next.
    //
    private given = 0;

    //
    // Gives the next reading of the sequence.
    //
    next(): IReading {
        const unit = UNITS[this.given % UNITS.length];
        assert(unit !== undefined);
        this.given += 1;
        return {
            unit,
            value: 50,
        };
    }
}
