// Scenarios for the source of randomness a run draws from.
//
// Two runs of one seed drawing the same numbers is what makes a failure replayable, and no single
// call shows it: it takes two.

import type { Checklist, Injector } from "faultline";
import { SeededRng } from "./random.ts";

// Two sources built on one seed draw the same everything.
export function twoSourcesOnOneSeedDrawTheSame(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const left = new SeededRng(29);
    const right = new SeededRng(29);
    for (let at = 0; at < 50; at += 1) {
        if (left.next() !== right.next()) {
            throw new Error("TwoSourcesOnOneSeedDrewDifferentNumbers");
        }
        if (left.int(0, 100) !== right.int(0, 100)) {
            throw new Error("TwoSourcesOnOneSeedDrewDifferentWholeNumbers");
        }
        if (left.pick([1, 2, 3]) !== right.pick([1, 2, 3])) {
            throw new Error("TwoSourcesOnOneSeedPickedDifferently");
        }
        if (left.uuid() !== right.uuid()) {
            throw new Error("TwoSourcesOnOneSeedMadeDifferentIdentifiers");
        }
        if (Buffer.from(left.bytes(8)).toString("hex") !== Buffer.from(right.bytes(8)).toString("hex")) {
            throw new Error("TwoSourcesOnOneSeedDrewDifferentBytes");
        }
    }
    // Two different seeds do not.
    if (new SeededRng(29).next() === new SeededRng(31).next()) {
        throw new Error("TwoSourcesOnDifferentSeedsDrewTheSame");
    }
}

// What a source answers at the edges.
export function whatASourceAnswersAtTheEdges(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const held = new SeededRng(29);
    for (let at = 0; at < 200; at += 1) {
        const drawn = held.next();
        if (drawn < 0 || drawn >= 1) {
            throw new Error("ANumberWasDrawnOutsideWhatWasPromised");
        }
        const whole = held.int(3, 5);
        if (whole < 3 || whole > 5) {
            throw new Error("AWholeNumberWasDrawnOutsideWhatWasAskedFor");
        }
    }
    if (held.int(7, 7) !== 7) {
        throw new Error("ARangeOfOneDidNotGiveThatOne");
    }
    if (held.bytes(0).length !== 0) {
        throw new Error("NoBytesAskedForGaveSome");
    }
    if (held.uuid().length !== 36) {
        throw new Error("TheIdentifierWasNotTheRightLength");
    }
    // Picking from nothing is the caller's error to avoid, and it is said rather than guessed at.
    let refused = false;
    try {
        held.pick([]);
    }
    catch {
        refused = true;
    }
    if (!refused) {
        throw new Error("PickingFromNothingGaveSomething");
    }
}
