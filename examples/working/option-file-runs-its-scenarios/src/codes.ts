//
// Checking a code a person types against the digit at its end.
//

import assert from "node:assert/strict";

//
// Whether the code's last digit is the sum of its other digits, kept to one digit.
//
export function isCodeValid(code: string): boolean {
    assert(typeof code === "string");
    const digits = [...code].map((character) => Number(character));
    const last = digits.pop();
    const sum = digits.reduce((total, digit) => total + digit, 0);
    if (last === sum % 10) {
        return true;
    }
    return false;
}
