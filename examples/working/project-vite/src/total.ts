//
// The price of an order, reaching the cart through a path alias and importing a stylesheet the way
// a bundler allows.
//

import assert from "node:assert/strict";
import { subtotal, type ILine } from "@/lib/cart.ts";
import "./styles.css";

//
// Writes out what an order costs, or says it is free.
//
export function priceOf(lines: ILine[]): string {
    const amount = subtotal(lines);
    assert(typeof amount === "number");
    if (amount === 0) {
        return "free";
    }
    return amount.toFixed(2);
}
