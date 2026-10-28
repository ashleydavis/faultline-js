//
// Callers for the functions in greet.ts: one with a name and one without.
//

//
// A caller who gave their name.
//
export function namedCaller(): ICaller {
    return {
        name: "Sam",
    };
}

//
// A caller who gave none.
//
export function guestCaller(): ICaller {
    return {
        name: "",
    };
}
