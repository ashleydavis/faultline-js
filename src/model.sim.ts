// Scenarios for writing a plan down and reading one back.
//
// A plan is text somebody types, and a made up string is not one of them.

import type { Checklist, Injector } from "faultline";
import { formatPlan, parsePlan } from "./model.ts";

// A plan written down and read back, both ways round.
export function aPlanWrittenDownAndReadBack(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    for (const plan of [{ seed: 7 }, { seed: 7, fn: "a.ts#held" }]) {
        const written = formatPlan(plan);
        const read = parsePlan(written);
        if (read.seed !== plan.seed || read.fn !== plan.fn) {
            throw new Error(`ThePlanDidNotComeBackAsItWentIn: ${written}`);
        }
    }
    parsePlan("seed=7, fn=a.ts#held");
    parsePlan("seed=7,");
}

// Every plan the reader refuses, because a plan it does not understand would drive something other
// than what was asked for.
export function everyPlanTheReaderRefuses(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    for (const text of ["", "fn=a.ts#held", "seed", "seed=not-a-number", "seed=1.5", "seed=7,made-up=1"]) {
        let refused = false;
        try {
            parsePlan(text);
        }
        catch {
            refused = true;
        }
        if (!refused) {
            throw new Error(`ThePlanReaderTook_${text}_WhichItShouldRefuse`);
        }
    }
}
