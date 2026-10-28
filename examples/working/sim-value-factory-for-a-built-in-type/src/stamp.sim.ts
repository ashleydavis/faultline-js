//
// The dates a record can be made at: every one valid, because the code that makes them checks.
//

//
// A moment before the epoch.
//
export function madeLongAgo(): Date {
    return new Date("1969-07-20T20:17:00.000Z");
}

//
// A moment after the epoch.
//
export function madeRecently(): Date {
    return new Date("2024-01-01T00:00:00.000Z");
}
