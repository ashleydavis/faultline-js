// The run the replaced globals and modules ask.
//
// A file read or a fetch made by the code under test reaches the tool through a global or a module
// it already imports, not through anything the project declares. There is nowhere in such a call to
// carry the run it belongs to, so the run is held here: one at a time, put in place by the driver
// before it calls anything and taken away after.
//
// The original does the same thing for the same reason. Its own note in network.zig says the
// userdata pointer belongs to whatever is underneath, and there is nowhere else to put the state.

import type { RunSubject } from "./subject.ts";

// The run in flight, or nothing when the tool itself is doing the running.
let running: RunSubject | undefined;

// Whether a run is driving the code under test at all.
let driving = false;

// Says that the driving has begun. After this, a call the code under test left in flight never
// reaches the machine: it lands in the tree of the unit that started it rather than on the disk.
export function startDriving(): void {
    driving = true;
}

// The run in flight. A replacement that gets nothing does what the real thing does, so the tool's
// own reads and fetches are its own.
export function nowRunning(): RunSubject | undefined {
    return running;
}

// Puts one run in flight, and hands back what was there so the caller puts it back.
export function runWith(subject: RunSubject | undefined): RunSubject | undefined {
    const held = running;
    running = subject ?? (driving ? held : undefined);
    return held;
}

// Says that the driving is over, so a test leaves the runtime as it found it.
export function stopDriving(): void {
    driving = false;
    running = undefined;
}
