//
// A value factory per size of box, so each branch of `boxSize` is reached.
//

import assert from "node:assert/strict";
import type { Box } from "./box.d.ts";

//
// A box holding a small number. The code under test never wraps a box, so wrapping one fails.
//
export function smallBox(): Box<number> {
    const box: Box<number> = {
        value: 2,
        wrap(): Box<Box<number>> {
            assert.fail("The code under test never wraps a box.");
        },
    };
    assert(box.value < 10);
    return box;
}

//
// A box holding a large number. The code under test never wraps a box, so wrapping one fails.
//
export function largeBox(): Box<number> {
    const box: Box<number> = {
        value: 200,
        wrap(): Box<Box<number>> {
            assert.fail("The code under test never wraps a box.");
        },
    };
    assert(box.value > 10);
    return box;
}
