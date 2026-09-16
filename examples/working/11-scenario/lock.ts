// A path that needs two calls in an order, which is what a scenario is for.

// A lock that refuses a second holder.
export class Lock {
    // Whether somebody holds it.
    private held = false;

    // Takes it, or refuses because somebody already has it.
    take(): boolean {
        if (this.held) {
            return false;
        }
        this.held = true;
        return true;
    }

    // Gives it back.
    release(): void {
        this.held = false;
    }
}
