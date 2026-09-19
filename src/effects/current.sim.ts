// Scenarios for the run the replaced globals and modules ask.
//
// Which run is in flight is not an argument to anything, so no made up call changes it.

import type { Checklist, Injector } from "faultline";
import { nowRunning, runWith, startDriving, stopDriving } from "./current.ts";
import { RunSubject } from "./subject.ts";

// Putting a run in flight and taking it away again.
export function puttingARunInFlight(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const outer = nowRunning();
    const first = new RunSubject(37, "clean");
    const second = new RunSubject(41, "clean");
    try {
        const before = runWith(first);
        if (nowRunning() !== first) {
            throw new Error("TheRunPutInFlightWasNotTheOneAsked");
        }
        if (runWith(second) !== first) {
            throw new Error("PuttingARunInFlightDidNotHandBackTheOneThatWasThere");
        }
        runWith(before);
    }
    finally {
        runWith(outer);
    }
}

// A run the code under test left in flight, which lands in that unit's own tree rather than on the
// machine.
export function aRunLeftInFlight(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const outer = nowRunning();
    const held = new RunSubject(37, "clean");
    try {
        startDriving();
        runWith(held);
        runWith(undefined);
        if (nowRunning() !== held) {
            throw new Error("ARunLeftInFlightWasTakenAwayWhileDriving");
        }
        stopDriving();
        if (nowRunning() !== undefined) {
            throw new Error("ARunWasStillInFlightOnceTheDrivingWasOver");
        }
    }
    finally {
        stopDriving();
        startDriving();
        runWith(outer);
    }
}
