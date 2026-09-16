// What decides whether an effect fails, and what it fails with.
//
// A run makes an effect fail two ways. A scenario asks for a named failure through the injector,
// and an ordinary call gets one at a rate the run sets, drawn from this run's own seed. Both come
// through here so a plan can name either.

import type { EffectName, Injector } from "../runtime/index.ts";
import type { SeededRng } from "./random.ts";

// The ways each effect can go wrong. An effect only ever fails with one of its own names, so a
// plan naming a failure is either understood or refused.
export const failuresByEffect: Record<EffectName, string[]> = {
    net: ["refused", "timeout", "dns", "server-error", "bad-body"],
    files: ["missing", "denied", "io", "is-directory", "full"],
    writer: ["short", "closed", "broken-pipe"],
    clock: ["backwards", "jump"],
    rng: [],
    // A function the run passed in, which the code under test calls and which goes wrong. This is
    // how the code that handles a callback throwing is reached.
    calls: ["throws", "rejects"],
    // A value the run passed in arriving as nothing at all, whatever the type said. This is where
    // a TypeError comes from in a running program, and no type ever says it can happen.
    values: ["null", "undefined"],
};

// How often each effect fails when nothing asked it to, as one call in this many.
//
// Four is the rate for an effect, because a lower one leaves the error handling paths unreached in
// a short run. A value arriving as nothing is rarer, because it applies to every argument of every
// call rather than to one call site, and at one in four it costs more calls than it buys paths.
export const rateByEffect: Partial<Record<EffectName, number>> = {
    values: 16,
    calls: 6,
};

// One failure a run asked for, either by a scenario or by the draw below.
export interface AskedFailure {
    // Which effect is to fail.
    effect: EffectName;

    // Which of that effect's own failures it is to fail with.
    failure: string;
}

// What an injector is doing.
//
// "clean" fails only what a scenario asks for, so a pass under it proves the code runs before anything
// is broken underneath it. "faulting" also fails calls it draws from the seed, which reaches the
// error handling paths broadly and cheaply. "recording" is a clean pass that writes down every
// point an effect could have failed at, and "exploring" fails exactly one of those points, which is
// how every one of them is reached rather than the ones the dice happened to land on.
export type Mode = "clean" | "faulting" | "recording" | "exploring";

// One place an effect was called, named so a later run can fail exactly that one. It is the effect
// and how many times that effect had been called when it was reached, which is enough to tell two
// calls to the same effect in one function apart.
export interface Point {
    // Which effect was called.
    effect: EffectName;

    // How many times that effect had been called before this one.
    occurrence: number;
}

// A point written the one way, so a plan and a unit name it the same.
export function pointName(point: Point): string {
    return `${point.effect}#${point.occurrence}`;
}

// Answers every effect's question of whether this call fails.
export class RunInjector implements Injector {
    // What a scenario has asked for and no effect has taken yet.
    private queued: AskedFailure[] = [];

    // Every failure this injector handed out, in order, so a plan can be written from a run.
    readonly handedOut: AskedFailure[] = [];

    // Builds an injector. In "clean" mode no effect fails unless a scenario asks, which proves the
    // code runs before anything is broken underneath it.
    // Every point this injector was asked about, in the order it was asked. Filled in recording
    // mode and left empty in every other.
    readonly recorded: Point[] = [];

    // How many times each effect has been asked about. This numbers a point.
    private readonly seen = new Map<EffectName, number>();

    // The one point to fail in exploring mode, and what to fail it with.
    private exploring?: { point: string; failure: string };

    // Where the draw below comes from.
    private readonly rng: SeededRng;

    // Whether anything fails without a scenario asking for it.
    private readonly mode: Mode;

    // One call in this many fails when the mode is "faulting". Four is used because a lower rate
    // leaves the error handling paths unreached in a short run, and a higher one means the working
    // path is exercised too rarely to be sure it works.
    private readonly oneIn: number;

    constructor(rng: SeededRng, mode: Mode, oneIn = 4) {
        this.rng = rng;
        this.mode = mode;
        this.oneIn = oneIn;
    }

    // Says which one point to fail, and with what. Only an exploring injector is told this.
    explore(point: string, failure: string): void {
        this.exploring = { point, failure };
    }

    fail(effect: EffectName, failure: string): void {
        if (!failuresByEffect[effect].includes(failure)) {
            throw new Error(`The effect "${effect}" has no failure named "${failure}".`);
        }
        this.queued.push({ effect, failure });
    }

    failures(effect: EffectName): string[] {
        return [...failuresByEffect[effect]];
    }

    clear(): void {
        this.queued = [];
    }

    // Asks whether the next call to `effect` fails, and takes the answer off the queue when it
    // does. An effect calls this once per call and never decides for itself.
    check(effect: EffectName): string | undefined {
        const occurrence = this.seen.get(effect) ?? 0;
        this.seen.set(effect, occurrence + 1);
        const here: Point = { effect, occurrence };

        if (this.mode === "recording") {
            if (failuresByEffect[effect].length > 0) {
                this.recorded.push(here);
            }
            return undefined;
        }

        if (this.mode === "exploring") {
            const wanted = this.exploring;
            if (wanted !== undefined && wanted.point === pointName(here)) {
                this.handedOut.push({ effect, failure: wanted.failure });
                return wanted.failure;
            }
            return undefined;
        }

        for (let index = 0; index < this.queued.length; index += 1) {
            if (this.queued[index]!.effect === effect) {
                const taken = this.queued.splice(index, 1)[0]!;
                this.handedOut.push(taken);
                return taken.failure;
            }
        }
        if (this.mode === "clean") {
            return undefined;
        }
        const kinds = failuresByEffect[effect];
        if (kinds.length === 0) {
            return undefined;
        }
        if (this.rng.int(1, rateByEffect[effect] ?? this.oneIn) !== 1) {
            return undefined;
        }
        const drawn = this.rng.pick(kinds);
        this.handedOut.push({ effect, failure: drawn });
        return drawn;
    }
}
