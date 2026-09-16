// What the process that reads the project and the process that drives it say to each other.

// One piece of work the driver does: one target exercised against one seed.
export interface Unit {
    // Where this unit sits in the list. A restart resumes from it.
    index: number;

    // What the unit does. "explore" calls one function once to see where its effects could fail,
    // and then once more per place and per way, so every one of them is reached rather than the
    // ones a draw happened to land on.
    kind: "scenario" | "call" | "explore";

    // The seed every value and every injected fault in this unit is drawn from.
    seed: number;

    // Whether anything fails underneath the code without a scenario asking.
    faulting: boolean;

    // Which scenario to run, for a unit that runs one.
    scenario?: number;

    // Which file the function is in, for a unit that calls one.
    file?: number;

    // Which function in that file to call, for a unit that calls one.
    fn?: number;
}

// The key a function is counted under, which is its file and the name the report gives it.
export function functionKey(file: string, label: string): string {
    return `${file}#${label}`;
}

// What the driver says when it has finished one unit.
export interface UnitDone {
    // Says which kind of message this is.
    type: "unit";

    // The unit that finished.
    index: number;

    // How many calls the unit made.
    calls: number;

    // How many calls were stepped over because the code threw on an input it was never written
    // for.
    stepped: number;

    // The function the unit called, when it called one.
    fn?: string;

    // Why the function could not be called, when it could not be.
    cannotBuild?: { parameter: string; typeText: string };
}

// What the driver says when it has read what V8 counted. V8 counts from the moment coverage starts
// and never resets, so the newest reading for a script is the whole truth about it.
export interface CoverageTaken {
    // Says which kind of message this is.
    type: "coverage";

    // What V8 reported for the copies this run loaded.
    scripts: import("../coverage/v8.ts").ScriptCoverage[];
}

// What the driver says when a scenario or an invariant said the answer was wrong, which stops the
// run.
export interface ScenarioFailed {
    // Says which kind of message this is.
    type: "failed";

    // Whether it was a scenario that said so, or an invariant that stopped holding.
    kind: "scenario" | "invariant";

    // The seed the scenario ran against.
    seed: number;

    // Where the scenario is written.
    where: string;

    // What the scenario said went wrong.
    error: string;
}

// What the driver says once it has loaded the model and is about to start work. Until it says
// this, what it is doing is starting up rather than running a call, and the two are allowed
// different amounts of time.
export interface DriverReady {
    // Says which kind of message this is.
    type: "ready";
}

// What the driver says when it has run out of work.
export interface DriverFinished {
    // Says which kind of message this is.
    type: "finished";
}

// What the driver says when it could not start at all.
export interface DriverBroke {
    // Says which kind of message this is.
    type: "broke";

    // What went wrong, written the way the runtime wrote it.
    error: string;

    // The module that would not load, when one would not.
    module?: string;
}

// Everything the driver can say.
export type FromDriver = DriverReady | UnitDone | CoverageTaken | ScenarioFailed | DriverFinished | DriverBroke;

// What the driver is told when it starts.
export interface ToDriver {
    // Where the run's model was written.
    model: string;

    // The unit to start at, which is how a restart carries on past one that hung.
    from: number;

    // The work to do, where the caller has its own list. Left out, the driver builds the list every
    // round one drives.
    units?: Unit[];

    // The path names earlier rounds reached, which is what a scenario reads off the checklist.
    ticked?: string[];
}
