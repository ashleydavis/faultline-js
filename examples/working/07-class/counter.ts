// Every member of a class is exercised: the constructor, the methods and the accessors.

export class Counter {
    // What has been added so far.
    private total: number;

    // Where the count starts, which the run fills from its type like any other parameter.
    constructor(start = 0) {
        this.total = start;
    }

    // Adds an amount, refusing one below zero.
    add(amount: number): number {
        if (amount < 0) {
            return this.total;
        }
        this.total += amount;
        return this.total;
    }

    // What has been added so far.
    get value(): number {
        return this.total;
    }

    // Puts the count back to a number given.
    set value(to: number) {
        this.total = to;
    }

    // Builds one starting at zero, which is a method on the class rather than on an instance.
    static empty(): Counter {
        return new Counter(0);
    }
}
