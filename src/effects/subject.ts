// What a run hands a scenario, and what it builds effect parameters from.

import type { Checklist, Subject } from "../runtime/index.ts";
import { RunClock, RunFiles, RunNet, RunWriter } from "./effects.ts";
import { RunInjector, type Mode } from "./injector.ts";
import { SeededRng } from "./random.ts";

// Every effect of one run, wired to one seed and one injector.
export class RunSubject implements Subject {
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
    constructor(seed: number, mode: Mode) {
        this.rng = new SeededRng(seed);
        this.injector = new RunInjector(this.rng, mode);
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
