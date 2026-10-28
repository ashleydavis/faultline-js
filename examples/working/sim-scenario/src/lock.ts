//
// A code path that needs two calls in an order, which is what a scenario is for.
//

import assert from "node:assert/strict";

//
// A lock that refuses a second holder.
//
export class Lock {
    //
    // Whether the lock is held.
    //
    private held = false;

    //
    // Takes the lock, or refuses because it is held already.
    //
    take(): boolean {
        if (this.held) {
            return false;
        }
        this.held = true;
        assert(this.held);
        return true;
    }

    //
    // Gives the lock back.
    //
    release(): void {
        this.held = false;
        assert(!this.held);
    }
}
