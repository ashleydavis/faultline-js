//
// What the run is given for the order book: a value factory per kind of order, a value factory
// written as a class and the scenarios no single call makes. A type with a value factory takes only
// the values its factories give, so there is one factory for every kind of order the book handles.
//

import assert from "node:assert/strict";
import type { ScenarioContext } from "faultline";
import { Book, firstThat, lineFor, ordersIn, type IOrder } from "./orders.ts";

//
// A buy order that names no price, so the default price is used.
//
export function aBuyAtTheDefaultPrice(): IOrder {
    const order: IOrder = {
        kind: "buy",
        count: 2,
    };
    assert(order.price === undefined);
    return order;
}

//
// A sell order that names no price.
//
export function aSellAtTheDefaultPrice(): IOrder {
    const order: IOrder = {
        kind: "sell",
        count: 1,
    };
    assert(order.price === undefined);
    return order;
}

//
// A buy order with a price, so the price it names is used.
//
export function aPricedBuy(): IOrder {
    const order: IOrder = {
        kind: "buy",
        count: 2,
        price: 3,
    };
    assert(order.count > 0);
    return order;
}

//
// A cancellation, which comes to zero.
//
export function aCancellation(): IOrder {
    const order: IOrder = {
        kind: "cancel",
        count: 1,
    };
    assert(order.kind === "cancel");
    return order;
}

//
// An order for none of the thing, which a book does not take.
//
export function anEmptyOrder(): IOrder {
    const order: IOrder = {
        kind: "buy",
        count: 0,
    };
    assert(order.count === 0);
    return order;
}

//
// An order with a price below zero, which a book does not take.
//
export function aMistakenPrice(): IOrder {
    const order: IOrder = {
        kind: "sell",
        count: 1,
        price: -1,
    };
    assert(order.count > 0);
    return order;
}

//
// Books holding one order each, a bigger sale each time.
//
export class Books {
    //
    // How many books have been built, which sets the count of the next one's order.
    //
    private built = 0;

    //
    // Gives a book with one sell order in it.
    //
    aBook(): Book {
        this.built += 1;
        const book = Book.holding({
            kind: "sell",
            count: this.built,
            price: 4,
        });
        assert(book.total() < 0);
        return book;
    }
}

//
// Text with a line that parses, a line that does not and an empty line.
//
export function aRefusedLine(context: ScenarioContext): void {
    const read = ordersIn("{\"kind\":\"buy\",\"count\":1}\nnot json at all\n\n");
    assert(Array.isArray(read.orders));
    context.expect(read.orders.length === 1, "The line that parses is read.");
    context.expect(read.refused.join() === "not json at all", "The line that is not JSON is refused.");
}

//
// A name changed to the empty name and then to another, and lines with and without words after
// them.
//
export function aNameChanged(context: ScenarioContext): void {
    const book = new Book("held");
    book.name = "";
    context.expect(book.name === "held", "An empty name leaves the book's name as it was.");
    book.name = "changed";
    context.expect(book.name === "changed", "A new name is taken.");
    const plain = lineFor({
        kind: "cancel",
        count: 0,
    });
    assert(typeof plain === "string");
    context.expect(plain === "cancel 0", "A line with no words after it names only the order.");
    context.expect(lineFor({
        kind: "buy",
        count: 1,
    }, "first", "second") === "buy 1, first, second", "The words after an order are written after it.");
}

//
// A book with a buy and a sell, filtered by kind.
//
export function aBookFilteredByKind(context: ScenarioContext): void {
    const book = new Book("mixed");
    book.add({
        kind: "buy",
        count: 2,
        price: 3,
    });
    book.add({
        kind: "sell",
        count: 1,
        price: 4,
    });
    assert(book.total() === 2);
    context.expect(book.of("buy").length === 1, "Only the buy order is of kind buy.");
}

//
// A list holding something the question says yes to, which takes a list and a question both
// changed from the values Faultline starts with, so no single call it makes finds one.
//
export function aThingFound(context: ScenarioContext): void {
    const found = firstThat([1, 2, 3], (thing: number): boolean => thing > 1);
    assert(found !== undefined);
    context.expect(found === 2, "The first thing the question says yes to is given.");
}
