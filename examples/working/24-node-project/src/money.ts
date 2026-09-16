// What an amount of money is.
export interface Money {
    // How many of the smallest unit.
    cents: number;

    // Which currency those units are.
    currency: string;
}

// Writes an amount out.
export function format(money: Money): string {
    if (money.cents < 0) {
        return `-${format({ cents: -money.cents, currency: money.currency })}`;
    }
    const whole = Math.floor(money.cents / 100);
    const part = String(money.cents % 100).padStart(2, "0");
    return `${whole}.${part} ${money.currency}`;
}

// Adds two amounts, refusing two currencies.
export function add(a: Money, b: Money): Money {
    if (a.currency !== b.currency) {
        throw new Error("currency mismatch");
    }
    return { cents: a.cents + b.cents, currency: a.currency };
}
