// Every effect of one run, wired together.

import assert from "node:assert/strict";
import { Console } from "node:console";
import { Writable } from "node:stream";
import { RunClock } from "./clock.ts";
import { RunEnvironment } from "./environment.ts";
import { RunFiles } from "./filesystem.ts";
import { Injector, type PlannedFailure } from "./injector.ts";
import type { IProgramAnswer } from "../sim/index.ts";
import { RunNetwork } from "./network.ts";
import { SeededRng } from "./random.ts";
import { RunInput, RunOutput } from "./streams.ts";

// What `process.exit` throws while a run is in flight. Node's own never returns, and throwing is
// the one way to stop the call where it asked to end. Ending there is no failure: the code paths
// the call ran up to that point count as exercised.
export class ProcessExitCalled extends Error {
    // The code the call asked to exit with.
    readonly exitCode: number;

    constructor(exitCode: number) {
        super(`The code under test called process.exit(${exitCode}).`);
        this.name = "ProcessExitCalled";
        this.exitCode = exitCode;
    }
}

// Every effect of one run, wired to one seed and one planned failure.
//
// A project never sees this. The replaced globals and modules read it off the run in flight, so
// code that reads the clock or a file reaches this without declaring anything.
export class RunSubject {
    // This run's source of randomness, which every effect draws from.
    readonly rng: SeededRng;

    // What decides which effect calls fail.
    readonly injector: Injector;

    // This run's clock and timers.
    readonly clock: RunClock;

    // This run's files.
    readonly files: RunFiles;

    // This run's network.
    readonly network: RunNetwork;

    // This run's environment variables.
    readonly environment: RunEnvironment;

    // What `process.stdin` is.
    readonly stdin: RunInput;

    // What `process.stdout` is.
    readonly stdout: RunOutput;

    // What `process.stderr` is.
    readonly stderr: RunOutput;

    // What `console` writes through. It keeps what it writes on the run's output and error without
    // a place, because Node's console takes no notice of a stream that fails.
    readonly console: Console;

    // What `process.argv` is while the run is in flight: a copy of the real command line, made the
    // first time the run reads it, so what one call or scenario sets it to is never what the next
    // one reads. Undefined until then.
    processArgv: string[] | undefined = undefined;

    // What each program the code under test may run answers, by the name a scenario gave it, as a
    // scenario said. A program with no answer here prints nothing and exits with code 0.
    readonly programs = new Map<string, IProgramAnswer>();

    // The absolute path of the file a scenario started as the process's entry point, for which
    // `import.meta.main` is true, or undefined when none was.
    entryFile: string | undefined = undefined;

    // Builds every effect from one seed. Two subjects built with the same seed and the same planned
    // failure answer identically, and that is how a run is replayed.
    //
    // It clears `process.exitCode`, so that starts unset for every run, as it does for a process,
    // and what one call set is never what the next call reads. It is the process's own rather than
    // the run's because Node declares it so that it cannot be replaced.
    constructor(seed: number, planned: PlannedFailure | undefined) {
        process.exitCode = undefined;
        assert.equal(process.exitCode, undefined, "The process's exit code was not cleared for the run.");
        this.rng = new SeededRng(seed);
        this.injector = new Injector(planned);
        this.clock = new RunClock(this.injector);
        this.files = new RunFiles(this.injector, this.clock, this.rng);
        this.network = new RunNetwork(this.injector);
        this.environment = new RunEnvironment(this.injector);
        this.stdin = new RunInput(this.injector);
        this.stdout = new RunOutput(this.injector, 1);
        this.stderr = new RunOutput(this.injector, 2);
        this.console = new Console({
            stdout: keptBy(this.stdout),
            stderr: keptBy(this.stderr),
            ignoreErrors: true,
            colorMode: false,
        });
    }

    // Hands back what stops a call that asked to exit where it asked. With no code given, the code
    // is what `process.exitCode` holds, as Node takes it.
    exit(code: unknown): ProcessExitCalled {
        const given = code === undefined || code === null ? process.exitCode : code;
        const exitCode = given === undefined ? 0 : Number(given);
        return new ProcessExitCalled(exitCode);
    }
}

// A stream that keeps everything written to it on `output` without asking the injector.
function keptBy(output: RunOutput): Writable {
    return new Writable({
        write(chunk: unknown, _encoding: unknown, done: (error?: Error | null) => void) {
            output.keep(chunk);
            done(null);
        },
    });
}
