//
// An order book, written the way ordinary code is written: a class with a constructor, methods, a
// getter, a setter and a static method, a function the file does not export, a function written
// inside another, a switch, a loop, a short circuit, a try and its catch, a generic, an optional
// property and a rest parameter.
//

import assert from "node:assert/strict";

//
// What an order is for.
//
export type Kind = "buy" | "sell" | "cancel";

//
// One order someone placed.
//
export interface IOrder {
    //
    // What the order is for.
    //
    kind: Kind;

    //
    // How many of the thing.
    //
    count: number;

    //
    // What each one costs, when the order says.
    //
    price?: number;
}

//
// What each one costs when an order does not say. It is one so a count reads as its own total.
//
const DEFAULT_PRICE = 1;

//
// Gives what one order comes to, which is zero for a cancellation.
//
export function totalOf(order: IOrder): number {
    assert(typeof order.count === "number");
    switch (order.kind) {
        case "buy":
            return order.count * (order.price ?? DEFAULT_PRICE);
        case "sell":
            return -order.count * (order.price ?? DEFAULT_PRICE);
        default:
            return 0;
    }
}

//
// Says whether a book takes an order. A count of zero or less is no order, and a price below zero
// is a mistake.
//
function isTaken(order: IOrder): boolean {
    assert(typeof order.count === "number");
    return order.count > 0 && (order.price === undefined || order.price >= 0);
}

//
// Gives what a list of orders comes to, leaving out the orders a book does not take.
//
export function sumOf(orders: IOrder[]): number {
    assert(Array.isArray(orders));
    let total = 0;
    for (const order of orders) {
        if (!isTaken(order)) {
            continue;
        }
        total += totalOf(order);
    }
    return total;
}

//
// The orders read out of the text a book was sent, and the lines that would not parse.
//
export interface IReadOrders {
    //
    // The orders read, in the order of their lines.
    //
    orders: IOrder[];

    //
    // The lines that were not JSON, in the order they came.
    //
    refused: string[];
}

//
// Reads one order per line of JSON, keeping the lines that would not parse.
//
export function ordersIn(text: string): IReadOrders {
    assert(typeof text === "string");
    const read: IReadOrders = {
        orders: [],
        refused: [],
    };
    for (const line of text.split("\n")) {
        if (line === "") {
            continue;
        }
        try {
            const order: IOrder = JSON.parse(line);
            read.orders.push(order);
        }
        catch {
            read.refused.push(line);
        }
    }
    return read;
}

//
// Gives the first thing in a list the question says yes to, or undefined when it says yes to none.
//
export function firstThat<T>(things: T[], asked: (thing: T) => boolean): T | undefined {
    assert(Array.isArray(things));
    for (const thing of things) {
        if (asked(thing)) {
            return thing;
        }
    }
    return undefined;
}

//
// Writes a line naming an order, with whatever else the caller wants written after it.
//
export function lineFor(order: IOrder, ...also: string[]): string {
    assert(Array.isArray(also));
    const parts = [`${order.kind} ${String(order.count)}`, ...also];
    return parts.join(", ");
}

//
// A book of orders, which is what a caller holds on to.
//
export class Book {
    //
    // The orders in the book, oldest first.
    //
    private held: IOrder[] = [];

    //
    // What the book is called.
    //
    private named: string;

    //
    // Builds an empty book with a name.
    //
    constructor(named: string) {
        assert(typeof named === "string");
        this.named = named;
    }

    //
    // What the book is called.
    //
    get name(): string {
        assert(typeof this.named === "string");
        return this.named;
    }

    //
    // Changes what the book is called. An empty name leaves it as it was.
    //
    set name(to: string) {
        assert(typeof to === "string");
        if (to === "") {
            return;
        }
        this.named = to;
    }

    //
    // Adds one order and says whether the book took it.
    //
    add(order: IOrder): boolean {
        if (!isTaken(order)) {
            return false;
        }
        this.held.push(order);
        assert(this.held.length > 0);
        return true;
    }

    //
    // Gives what everything in the book comes to.
    //
    total(): number {
        assert(Array.isArray(this.held));
        return sumOf(this.held);
    }

    //
    // Gives the orders of one kind, oldest first. The match is written inside this method, which is
    // the only code that reaches it.
    //
    of(kind: Kind): IOrder[] {
        assert(typeof kind === "string");
        const isMatch = (order: IOrder): boolean => order.kind === kind;
        return this.held.filter(isMatch);
    }

    //
    // Builds a book holding one order, which is how a caller starts a book from a single order.
    //
    static holding(order: IOrder): Book {
        const book = new Book("one");
        book.add(order);
        assert(book.name === "one");
        return book;
    }
}
