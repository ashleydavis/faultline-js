//
// The scenario that stops a schedule, which only the code holding it can do.
//

import type { ScenarioContext } from "faultline";
import { startSchedule } from "./schedule.ts";

//
// Starts a schedule and stops it at once.
//
export function stopSchedule(context: ScenarioContext): void {
    const failures: number[] = [];
    const schedule = startSchedule(1, () => 1, failures);
    schedule.stop();
    context.expect(failures.length === 0, "a run that succeeded to be counted as no failure");
}
