// The entry point, reached through a path alias, and importing a stylesheet the way a bundler
// lets you.

import { subtotal, type Line } from "@/lib/cart.ts";
import "./styles.css";

export function priceOf(lines: Line[]): string {
    const amount = subtotal(lines);
    if (amount === 0) {
        return "free";
    }
    return amount.toFixed(2);
}
