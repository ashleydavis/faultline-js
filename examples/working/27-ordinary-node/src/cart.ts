// An ordinary shopping cart: plain data in, plain answers out.

export interface Item {
    name: string;
    price: number;
    quantity: number;
}

export function subtotal(items: Item[]): number {
    let total = 0;
    for (const item of items) {
        if (item.quantity <= 0) {
            continue;
        }
        total += item.price * item.quantity;
    }
    return total;
}

export function discountFor(total: number, code: string): number {
    if (code === "HALF") {
        return total / 2;
    }
    if (code === "TENOFF") {
        return Math.max(0, total - 10);
    }
    if (code === "") {
        return total;
    }
    return total;
}

export function shipping(total: number, country: string): number {
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

export function summarise(items: Item[], code: string, country: string): string {
    const before = subtotal(items);
    const after = discountFor(before, code);
    const post = shipping(after, country);
    if (items.length === 0) {
        return "empty";
    }
    return `${String(items.length)} items, ${String(after + post)} to pay`;
}
