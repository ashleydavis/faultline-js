//
// Amounts of money and the arithmetic on them.
//

import assert from "node:assert/strict";

//
// An amount of money.
//
export interface IMoney {
    //
    // How many of the smallest unit of the currency.
    //
    cents: number;

    //
    // Which currency the units are.
    //
    currency: string;
}

//
// Writes an amount out with two decimal places and its currency.
//
export function format(money: IMoney): string {
    const sign = money.cents < 0 ? "-" : "";
    const size = Math.abs(money.cents);
    const whole = Math.floor(size / 100);
    const part = String(size % 100).padStart(2, "0");
    assert(part.length >= 2);
    return `${sign}${whole}.${part} ${money.currency}`;
}

//
// Adds two amounts, or gives undefined for two currencies, which cannot be added.
//
export function add(first: IMoney, second: IMoney): IMoney | undefined {
    assert(typeof first.cents === "number");
    assert(typeof second.cents === "number");
    if (first.currency !== second.currency) {
        return undefined;
    }
    return {
        cents: first.cents + second.cents,
        currency: first.currency,
    };
}
