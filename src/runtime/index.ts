// The whole of what a project being fault tested imports.
//
// Every one of these is a type. There is no marker to write into your code and no channel to send
// one down: flt reads which code paths ran from your code itself, so a project carries none of the
// machinery that measures it.

// The clock a function reads the time from. Take one as a parameter and a run hands you a clock it
// controls, so the same call gives the same time on every machine.
export interface Clock {
    // Milliseconds since the epoch, as `Date.now` gives them.
    now(): number;

    // Milliseconds since this call started, which never goes backwards.
    monotonic(): number;

    // Waits. A run returns at once and moves its own clock forward instead, so a call that sleeps
    // for an hour still takes no time to exercise.
    sleep(milliseconds: number): Promise<void>;
}

// The source of randomness a function draws from. Take one as a parameter and a run hands you a
// seeded source, so a failure replays from its seed.
export interface Rng {
    // A number from zero up to but not including one.
    next(): number;

    // A whole number from `low` up to and including `high`.
    int(low: number, high: number): number;

    // One of `items`. Throws when `items` is empty, which is the caller's error to avoid.
    pick<T>(items: readonly T[]): T;

    // `count` bytes.
    bytes(count: number): Uint8Array;

    // A version 4 identifier drawn from this run's own bytes.
    uuid(): string;
}

// The network a function reaches out over. Take one as a parameter and a run hands you a network
// that answers, refuses, times out and returns a body that will not parse, in turn.
export interface Net {
    // Fetches a resource, with the same signature the global `fetch` has.
    fetch(input: string | URL, init?: RequestInit): Promise<Response>;
}

// The files a function reads and writes. Take one as a parameter and a run hands you a file system
// held in memory, which answers and fails in turn and never touches your disk.
export interface Files {
    // Reads a file as text.
    read(path: string): Promise<string>;

    // Reads a file as bytes.
    readBytes(path: string): Promise<Uint8Array>;

    // Writes a file as text, replacing what was there.
    write(path: string, contents: string): Promise<void>;

    // Whether a file is there.
    exists(path: string): Promise<boolean>;

    // The names directly inside a directory.
    list(path: string): Promise<string[]>;

    // Removes a file.
    remove(path: string): Promise<void>;
}

// Somewhere a function sends output. Take one as a parameter and a run hands you a writer that
// sometimes takes only part of what it was given, and sometimes refuses.
export interface Writer {
    // Writes text and answers how many characters it took, which can be fewer than it was given.
    write(text: string): Promise<number>;

    // Says no more is coming.
    end(): Promise<void>;
}

// The effects a run can make fail, named so a plan can write one down.
export type EffectName = "net" | "files" | "writer" | "clock" | "rng" | "calls" | "values";

// What a run hands a scenario: every effect, wired to this run's own seed, plus the trace that
// reads back what the code under test logged.
export interface Subject {
    // This run's clock.
    clock: Clock;

    // This run's source of randomness.
    rng: Rng;

    // This run's network.
    net: Net;

    // This run's files.
    files: Files;

    // This run's writer.
    writer: Writer;
}

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

// What a scenario looks like. A run finds a scenario by these three parameters, never by its name.
export type Scenario = (subject: Subject, injector: Injector, checklist: Checklist) => unknown;

// Something that has to hold after every call a run makes, and after every scenario.
//
// A run finds an invariant by its one parameter, which is how it is told from a scenario. Throw
// when it does not hold, and the run stops and prints the plan that reproduces it.
export type Invariant = (subject: Subject) => unknown;
