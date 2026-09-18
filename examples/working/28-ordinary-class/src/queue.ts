export class Queue<T> {
    private items: T[] = [];
    private limit: number;

    constructor(limit = 10) {
        this.limit = limit;
    }

    push(item: T): boolean {
        if (this.items.length >= this.limit) {
            return false;
        }
        this.items.push(item);
        return true;
    }

    pop(): T | undefined {
        return this.items.shift();
    }

    get size(): number {
        return this.items.length;
    }

    drain(each: (item: T) => void): number {
        let count = 0;
        while (this.items.length > 0) {
            each(this.items.shift()!);
            count += 1;
        }
        return count;
    }
}
