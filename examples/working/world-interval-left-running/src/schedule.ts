//
// Running a piece of work now and then on an interval, until whoever started it stops it.
//

import assert from "node:assert/strict";

//
// A running schedule, stopped by whoever started it.
//
export interface ISchedule {
    //
    // Runs the work no more.
    //
    stop(): void;
}

//
// Runs `work` now and then every `intervalMs`, until the schedule is stopped. A failed run is
// counted in `failures` and the schedule carries on, so one failure does not stop the rest.
//
export function startSchedule(intervalMs: number, work: () => number, failures: number[]): ISchedule {
    assert(typeof intervalMs === "number");
    assert(Array.isArray(failures));
    const wake = (): void => {
        try {
            work();
        }
        catch {
            failures.push(intervalMs);
        }
    };
    wake();
    const timer = setInterval(wake, intervalMs);
    return {
        stop(): void {
            clearInterval(timer);
        },
    };
}
