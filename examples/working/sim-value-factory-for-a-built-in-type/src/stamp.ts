//
// Writing the moment a record was made, for a log line.
//

import assert from "node:assert/strict";

//
// Gives the moment as the log writes it, or "before the epoch" for a moment earlier than 1970.
//
export function writeStamp(madeAt: Date): string {
    assert(madeAt instanceof Date);
    if (madeAt.getTime() < 0) {
        return "before the epoch";
    }
    return madeAt.toISOString();
}
