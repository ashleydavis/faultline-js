// The scenario that takes the lock twice, which no single call does.

import type { Checklist, Injector, Subject } from "faultline";
import { Lock } from "./lock.ts";

// flt finds a scenario by these three parameters. Most scenarios use only the first, and some use
// none of them: the injector is what makes an effect fail on purpose, and the checklist says which
// paths have been ticked so far.
export function takeItTwice(self: Subject, injector: Injector, checklist: Checklist): void {
    void self;
    void injector;
    void checklist;

    const lock = new Lock();
    if (!lock.take()) {
        throw new Error("TheFirstTakeWasRefused");
    }
    if (lock.take()) {
        throw new Error("TheSecondTakeWasAllowed");
    }
    lock.release();
}
