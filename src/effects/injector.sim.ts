// Scenarios for what decides whether an effect fails.
//
// What the injector does turns on the mode it was built in and on what a scenario asked it for,
// neither of which is an argument to the call that asks it.

import type { Checklist, Injector } from "faultline";
import { effectIn, failuresByEffect, pointName, rateByEffect, RunInjector } from "./injector.ts";
import { SeededRng } from "./random.ts";

// Every mode an injector runs in.
export function everyModeAnInjectorRunsIn(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    // Clean: nothing fails unless a scenario asks by name.
    const clean = new RunInjector(new SeededRng(23), "clean");
    for (let at = 0; at < 50; at += 1) {
        if (clean.check("files") !== undefined) {
            throw new Error("SomethingFailedUnderACleanRunWithNothingAsked");
        }
    }
    clean.fail("files", "missing");
    if (clean.check("files") !== "missing") {
        throw new Error("TheFailureAScenarioAskedForWasNotHandedOut");
    }
    clean.fail("net", "refused");
    clean.clear();
    if (clean.check("net") !== undefined) {
        throw new Error("AFailureTakenBackWasStillHandedOut");
    }

    // Faulting: calls fail at a rate drawn from the seed.
    const faulting = new RunInjector(new SeededRng(23), "faulting");
    let failed = 0;
    for (let at = 0; at < 400; at += 1) {
        if (faulting.check("files") !== undefined) {
            failed += 1;
        }
    }
    if (failed === 0) {
        throw new Error("NothingFailedUnderAFaultingRun");
    }
    // An effect with no failure of its own never fails.
    if (faulting.check("rng") !== undefined) {
        throw new Error("AnEffectWithNoFailureOfItsOwnFailed");
    }

    // Recording: nothing fails, and every place one could have is written down.
    const recording = new RunInjector(new SeededRng(23), "recording", 4, () => "/work/a.ts:1:1");
    recording.check("files");
    recording.check("rng");
    if (recording.recorded.length !== 1) {
        throw new Error("TheRecordingWroteDownTheWrongNumberOfPlaces");
    }

    // Exploring: one place fails, and every other call goes through.
    const exploring = new RunInjector(new SeededRng(23), "exploring", 4, () => "/work/a.ts:1:1");
    exploring.explore("files@/work/a.ts:1:1#1", "denied");
    if (exploring.check("files") !== undefined) {
        throw new Error("TheFirstCallFailedWhenTheSecondWasAskedFor");
    }
    if (exploring.check("files") !== "denied") {
        throw new Error("TheCallThatWasAskedForDidNotFail");
    }
    if (exploring.handedOut.length !== 1) {
        throw new Error("TheFailureHandedOutWasNotWrittenDown");
    }
    // One told nothing fails nothing.
    const toldNothing = new RunInjector(new SeededRng(23), "exploring", 4, () => "/work/a.ts:1:1");
    if (toldNothing.check("files") !== undefined) {
        throw new Error("AnExploringInjectorToldNothingFailedSomething");
    }
}

// A failure an effect has no name for, which is refused rather than handed out.
export function afailureAnEffectHasNoNameFor(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const held = new RunInjector(new SeededRng(23), "clean");
    let refused = false;
    try {
        held.fail("files", "made up");
    }
    catch {
        refused = true;
    }
    if (!refused) {
        throw new Error("AFailureTheEffectHasNoNameForWasTaken");
    }
    if (held.failures("files").length === 0) {
        throw new Error("TheEffectListedNoFailureOfItsOwn");
    }
}

// How a place is named, and which effect a name belongs to.
export function howAPlaceIsNamed(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (pointName({ effect: "files", site: "/work/a.ts:6:21", occurrence: 2 }) !== "files@/work/a.ts:6:21#2") {
        throw new Error("ThePlaceWasNotNamedAsItShouldBe");
    }
    if (effectIn("files@/work/a.ts:6:21#2") !== "files") {
        throw new Error("TheEffectWasNotReadOffTheFrontOfTheName");
    }
    if (effectIn("files") !== "files") {
        throw new Error("ANameWithNoSiteDidNotSayItsEffect");
    }
    if (effectIn("made-up@/work/a.ts:1:1#0") !== undefined) {
        throw new Error("ANameBelongingToNoEffectWasReadAsOne");
    }
    if (Object.keys(failuresByEffect).length === 0 || rateByEffect.values === undefined) {
        throw new Error("TheEffectsListedNothing");
    }
}
