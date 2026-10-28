// What decides whether an effect call fails, and what it fails with.
//
// Every effect call asks the injector before it does anything. The injector gives the call its
// place, writes down the place and the failures possible there, and answers with the one failure
// the call's plan names for that place, or with none. A call is planned with at most one failure,
// so each failure at each place is reached by a call of its own.

import assert from "node:assert/strict";
import { isFailureOf, type Effect } from "./failures.ts";
import { isSamePlace, PlaceCounter, type Place } from "./places.ts";

// The one failure a call is planned with: the place it happens at and which of that effect's
// failures it is.
export interface PlannedFailure {
    // Where the failure happens.
    place: Place;

    // The id of the failure, one of the place's own effect's rows in the failure table.
    failure: string;
}

// One place a call reached, with every failure that could have been injected there. The run loop
// plans one call per failure listed here.
export interface ReachedPlace {
    // Where the call reached.
    place: Place;

    // The ids of the failures the effect call there could have been given.
    failures: string[];
}

// Answers every effect call's question of whether it fails.
export class Injector {
    // Every place this call reached, in the order it reached them.
    readonly reached: ReachedPlace[] = [];

    // The failure this call is planned with, or none for a call that injects nothing.
    private readonly planned: PlannedFailure | undefined;

    // Numbers each effect call so it is given its place.
    private readonly counter = new PlaceCounter();

    // Whether effect calls are being counted and can fail. Expectation functions run with this off,
    // so what they read neither fails nor moves the places of the calls they check.
    private injecting = true;

    // Whether the planned failure has been handed out.
    private handedOut = false;

    constructor(planned: PlannedFailure | undefined) {
        if (planned !== undefined) {
            assert.ok(isFailureOf(planned.place.effect, planned.failure), `The effect "${planned.place.effect}" has no failure "${planned.failure}".`);
            assert.ok(planned.place.occurrence >= 0);
        }
        this.planned = planned;
    }

    // Whether the planned failure was handed out, so a call planned with a failure at a place it
    // never reached is known to have run with no failure.
    get injected(): boolean {
        return this.handedOut;
    }

    // Switches injection on or off. While it is off, effect calls are not counted, not written down
    // and never fail.
    setInjecting(on: boolean): void {
        this.injecting = on;
    }

    // Gives the next call of `effect` its place, writes it down with the failures `possible` there,
    // and answers with the failure to inject or with none.
    check(effect: Effect, possible: string[]): string | undefined {
        assert.ok(possible.length > 0, `An effect call of "${effect}" named no failure that can happen there.`);
        for (const failure of possible) {
            assert.ok(isFailureOf(effect, failure), `The effect "${effect}" has no failure "${failure}".`);
        }
        if (!this.injecting) {
            return undefined;
        }
        const place = this.counter.next(effect);
        this.reached.push({ place, failures: [...possible] });
        const planned = this.planned;
        if (planned === undefined || !isSamePlace(planned.place, place)) {
            return undefined;
        }
        if (!possible.includes(planned.failure)) {
            // The plan names a failure the call at this place cannot have, which happens when an
            // edit changed what the place is. The call runs with no failure, and `injected` says so.
            return undefined;
        }
        this.handedOut = true;
        return planned.failure;
    }
}
