// Scenarios for what a run hands a scenario, and for the checklist it reads.
//
// The checklist is over the path names earlier rounds reached, which a made up value is not.

import type { Checklist, Injector } from "faultline";
import { RunChecklist, RunSubject } from "./subject.ts";

// A run's own effects, all wired to one seed.
export function aRunsOwnEffects(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const held = new RunSubject(31, "clean");
    if (held.clock.now() !== new RunSubject(31, "clean").clock.now()) {
        throw new Error("TwoRunsOnOneSeedReadDifferentClocks");
    }
    if (held.rng.next() !== new RunSubject(31, "clean").rng.next()) {
        throw new Error("TwoRunsOnOneSeedDrewDifferentNumbers");
    }
    if (held.files === undefined || held.net === undefined || held.writer === undefined || held.injector === undefined) {
        throw new Error("TheRunWasMissingOneOfItsOwnEffects");
    }
    // The directory the copies sit in, which is what names a place in the project rather than in
    // the run's own directory.
    new RunSubject(31, "recording", "/work");
}

// The checklist a scenario reads, over what earlier rounds reached.
export function theChecklistAScenarioReads(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const held = new RunChecklist(new Set(["a.ts:if:1:true", "a.ts:if:1:false"]));
    if (!held.ticked("a.ts:if:1:true")) {
        throw new Error("TheChecklistSaidAPathThatRanDidNot");
    }
    if (held.ticked("a.ts:never-reached")) {
        throw new Error("TheChecklistSaidAPathRanThatDidNot");
    }
    const named = held.names();
    if (named.length !== 2) {
        throw new Error("TheChecklistNamedTheWrongNumberOfPaths");
    }
    if (named[0]! > named[1]!) {
        throw new Error("TheChecklistDidNotNameThemInOrder");
    }
    if (new RunChecklist(new Set()).names().length !== 0) {
        throw new Error("AnEmptyChecklistNamedSomething");
    }
}
