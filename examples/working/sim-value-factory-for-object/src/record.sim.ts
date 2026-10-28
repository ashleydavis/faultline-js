//
// The records a field count is asked of: one with fields and one with none.
//

//
// A record with two fields.
//
export function buildRecord(): object {
    return { name: "a", size: 1 };
}

//
// A record with no fields.
//
export function buildEmptyRecord(): object {
    return {};
}
