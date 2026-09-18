// The whole of what a project being fault tested imports.
//
// Every one of these is a type, and none of them is needed to be fault tested. A file the run
// measures imports nothing: the clock, the file system, the network, the timers and the rest are
// replaced underneath it, so code written the way code is written anywhere is exercised as it is.
//
// These are for the sim files beside it: a scenario that asks for one failure by name, and the
// checklist it reads.

// The effects a run can make fail, named so a plan can write one down.
export type EffectName = "net" | "files" | "writer" | "clock" | "rng" | "calls" | "values" | "process";

// Makes an effect fail on purpose, so a scenario can reach the code that handles it going wrong.
export interface Injector {
    // Makes the next call to `effect` fail with `failure`, which is one of the names that effect
    // lists in `failures`.
    fail(effect: EffectName, failure: string): void;

    // The failures `effect` can be asked for.
    failures(effect: EffectName): string[];

    // Takes back every failure asked for and not yet used.
    clear(): void;
}

// Reads which code paths a run has ticked so far. A scenario rarely needs this: a run reads what
// ran from the code itself, so a scenario says what to call and never says what it covered.
export interface Checklist {
    // Whether the path with this name has run at least once.
    ticked(name: string): boolean;

    // Every path name the run knows about.
    names(): string[];
}

// What a scenario looks like. A run finds a scenario by these parameters, never by its name.
//
// It calls your code the way your code is called anywhere, and the clock, the file system, the
// network and the rest are this run's own wherever your code reaches for them.
export type Scenario = (injector: Injector, checklist: Checklist) => unknown;

// Something that has to hold after every call a run makes, and after every scenario.
//
// A run finds an invariant by its taking nothing and returning nothing, which is how it is told
// from a scenario and from a test input factory. Throw when it does not hold, and the run stops and
// prints the plan that reproduces it.
export type Invariant = () => unknown;
