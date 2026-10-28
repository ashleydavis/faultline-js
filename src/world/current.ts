// The run the replaced globals and modules ask.
//
// A file read or a fetch made by the code under test reaches the tool through a global or a module
// it already imports, not through anything the project declares. There is nowhere in such a call to
// carry the run it belongs to, so the run is held here, put in place by the driver before it calls
// anything.
//
// A call is also made with its run held for its async context (`runInContext`). Work a call started
// and left running, such as a promise it never waited for, carries on in the context it was started
// in, so it keeps reaching its own run after the next call has started. Held for the process alone,
// it reached the next call's run: a call that set `process.argv` while it ran on set it for
// whichever call came after. Work started outside any call, such as the tool's own, gets the run in
// flight for the process.
//
// The original does the same thing for the same reason. Its own note in network.zig says the
// userdata pointer belongs to whatever is underneath, and there is nowhere else to put the state.

import { AsyncLocalStorage } from "node:async_hooks";
import type { RunSubject } from "./subject.ts";

// What a context holds when the tool is doing its own work with no run, which is told apart from
// a context that holds nothing, which takes the run in flight for the process.
const noRun = Symbol("no run");

// The run each async context was started in, or `noRun` for one that is the tool's own.
const startedIn = new AsyncLocalStorage<RunSubject | typeof noRun>();

// The run in flight for the process, or nothing when the tool itself is doing the running.
let running: RunSubject | undefined;

// Whether a run is driving the code under test at all.
let driving = false;

// Says that the driving has begun. After this, a call the code under test left in flight never
// reaches the machine: it lands in the tree of the unit that started it rather than on the disk.
export function startDriving(): void {
    driving = true;
}

// Whether the driving has begun. A replacement of something the tool itself uses to do the driving
// asks this rather than which run is in flight: a run stays in flight between one unit's calls and
// the next, and the driver's own is what the driving is made of.
export function isDriving(): boolean {
    return driving;
}

// The run in flight: the one the current async context was started in, or the process's when the
// context was started in none. A replacement that gets nothing does what the real thing does, so
// the tool's own reads and fetches are its own.
export function nowRunning(): RunSubject | undefined {
    const held = startedIn.getStore();
    if (held === noRun) {
        return undefined;
    }
    return held ?? running;
}

// Puts one run in flight for the process, and hands back what was there so the caller puts it
// back.
export function runWith(subject: RunSubject | undefined): RunSubject | undefined {
    const held = running;
    running = subject ?? (driving ? held : undefined);
    return held;
}

// Does `work` with `subject` held for its async context, so `work` and everything it starts, the
// promises it leaves running included, reach `subject` whatever run is in flight for the process
// when they run.
export function runInContext<T>(subject: RunSubject, work: () => T): T {
    return startedIn.run(subject, work);
}

// Does the tool's own work while a run is in flight with no run in flight, so what it reads (the
// environment, the working directory, the files a module is loaded from) is the machine's and never
// becomes a place of the call. Loading a module and formatting a stack trace are such work.
export function withoutRun<T>(work: () => T): T {
    const held = running;
    running = undefined;
    try {
        return startedIn.run(noRun, work);
    }
    finally {
        running = held;
    }
}

// Says that the driving is over, so a test leaves the runtime as it found it.
export function stopDriving(): void {
    driving = false;
    running = undefined;
}
