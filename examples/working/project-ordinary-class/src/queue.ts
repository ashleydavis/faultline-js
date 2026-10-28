//
// A queue that holds at most a fixed number of items.
//

import assert from "node:assert/strict";

//
// Items waiting their turn, oldest first, up to a limit.
//
export class Queue<T> {
    //
    // The items waiting, oldest first.
    //
    private items: T[] = [];

    //
    // The most items the queue holds at once.
    //
    private limit: number;

    //
    // Builds an empty queue that holds at most `limit` items.
    //
    constructor(limit: number) {
        assert(typeof limit === "number");
        this.limit = limit;
    }

    //
    // Adds an item at the back, or refuses it when the queue is full.
    //
    push(item: T): boolean {
        if (this.items.length >= this.limit) {
            return false;
        }
        this.items.push(item);
        assert(this.items.length <= this.limit);
        return true;
    }

    //
    // How many items are waiting.
    //
    get size(): number {
        assert(this.items.length >= 0);
        return this.items.length;
    }

    //
    // Hands every waiting item to `each`, oldest first, empties the queue and gives how many it
    // handed over.
    //
    drain(each: (item: T) => void): number {
        const waiting = this.items;
        this.items = [];
        for (const item of waiting) {
            each(item);
        }
        assert(this.items.length === 0);
        return waiting.length;
    }
}
