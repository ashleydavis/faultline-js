// A scenario that says the answer is wrong, which stops the run.

import type { Checklist, Injector, Subject } from "faultline";
import { addOne } from "./adding.ts";

export function addsWrong(self: Subject, injector: Injector, checklist: Checklist): void {
    void self;
    void injector;
    void checklist;

    if (addOne(1) !== 3) {
        throw new Error("AddedWrong");
    }
}
