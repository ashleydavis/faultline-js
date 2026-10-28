//
// A shopping cart: plain data in and plain answers out.
//

import assert from "node:assert/strict";

//
// One line of a cart.
//
export interface IItem {
    //
    // What the item is called.
    //
    name: string;

    //
    // What one costs.
    //
    price: number;

    //
    // How many are wanted. A line with none or fewer is left out of the total.
    //
    quantity: number;
}

//
// Gives what the items come to, leaving out lines that want none.
//
export function subtotal(items: IItem[]): number {
    assert(Array.isArray(items));
    let total = 0;
    for (const item of items) {
        if (item.quantity <= 0) {
            continue;
        }
        total += item.price * item.quantity;
    }
    return total;
}

//
// Gives a total after the discount a code names, or the total as it was for a code it does not
// know.
//
export function discountFor(total: number, code: string): number {
    assert(typeof total === "number");
    assert(typeof code === "string");
    if (code === "HALF") {
        return total / 2;
    }
    if (code === "TENOFF") {
        return Math.max(0, total - 10);
    }
    return total;
}

//
// Gives what shipping costs to a country, which is free over 100.
//
export function shipping(total: number, country: string): number {
    assert(typeof total === "number");
    assert(typeof country === "string");
    if (total > 100) {
        return 0;
    }
    switch (country) {
        case "AU":
            return 12;
        case "US":
            return 8;
        default:
            return 20;
    }
}

//
// Writes out how many items there are and what they come to with the discount and shipping.
//
export function summarise(items: IItem[], code: string, country: string): string {
    assert(Array.isArray(items));
    if (items.length === 0) {
        return "empty";
    }
    const discounted = discountFor(subtotal(items), code);
    const due = discounted + shipping(discounted, country);
    return `${String(items.length)} items, ${String(due)} to pay`;
}
