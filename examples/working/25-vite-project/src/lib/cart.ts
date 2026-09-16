// One line of an order.
export interface Line {
    // What one costs.
    price: number;

    // How many were wanted.
    quantity: number;
}

// What the lines come to before any discount.
export function subtotal(lines: Line[]): number {
    let total = 0;
    for (const line of lines) {
        total += line.price * line.quantity;
    }
    return total;
}
