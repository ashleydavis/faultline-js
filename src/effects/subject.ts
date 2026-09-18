// What a run hands a scenario, and what it builds effect parameters from.

import type { Checklist } from "../runtime/index.ts";
import { RunClock, RunFiles, RunNet, RunWriter } from "./effects.ts";
import { RunInjector, type Mode } from "./injector.ts";
import { SeededRng } from "./random.ts";
import { callSite } from "./site.ts";

// Every effect of one run, wired to one seed and one injector.
//
// A project never sees this. The replaced globals and modules read it off the run in flight, so
// code that reads the clock or a file reaches this without declaring anything.
export class RunSubject {
    // This run's source of randomness, which every effect and every made up value draws from.
    readonly rng: SeededRng;

    // What decides which calls fail.
    readonly injector: RunInjector;

    // This run's clock.
    readonly clock: RunClock;

    // This run's network.
    readonly net: RunNet;

    // This run's files.
    readonly files: RunFiles;

    // This run's writer.
    readonly writer: RunWriter;

    // Builds every effect from one seed. Two subjects built with the same seed and the same mode
    // answer identically, and that is how a run is replayed.
    //
    // `work` is where the copies of the project were put, so a place an effect could fail is named
    // by the path in the project rather than by that run's own directory.
    constructor(seed: number, mode: Mode, work = "") {
        this.rng = new SeededRng(seed);
        this.injector = new RunInjector(this.rng, mode, 4, () => callSite(work));
        this.clock = new RunClock(this.injector);
        this.net = new RunNet(this.injector, this.rng);
        this.files = new RunFiles(this.injector);
        this.writer = new RunWriter(this.injector);
    }
}

// The checklist a scenario reads, over the set of path names a run has ticked so far.
export class RunChecklist implements Checklist {
    // The path names this run has ticked.
    private readonly hit: Set<string>;

    constructor(hit: Set<string>) {
        this.hit = hit;
    }

    ticked(name: string): boolean {
        return this.hit.has(name);
    }

    names(): string[] {
        return [...this.hit].sort();
    }
}
