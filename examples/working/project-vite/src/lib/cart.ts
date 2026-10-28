//
// The lines of an order and what they come to.
//

import assert from "node:assert/strict";

//
// One line of an order.
//
export interface ILine {
    //
    // What one costs.
    //
    price: number;

    //
    // How many were wanted.
    //
    quantity: number;
}

//
// Gives what the lines come to before any discount.
//
export function subtotal(lines: ILine[]): number {
    assert(Array.isArray(lines));
    let total = 0;
    for (const line of lines) {
        total += line.price * line.quantity;
    }
    return total;
}
