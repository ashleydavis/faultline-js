// A scenario that says the answer is wrong, which stops the run.

import type { Checklist, Injector } from "faultline";
import { addOne } from "./adding.ts";

export function addsWrong(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (addOne(1) !== 3) {
        throw new Error("AddedWrong");
    }
}
