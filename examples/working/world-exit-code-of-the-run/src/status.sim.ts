//
// The scenarios that set the exit code and read it, and that read it in a run of their own.
//

import type { ScenarioContext } from "faultline";
import { markFailed, readStatus } from "./status.ts";

//
// Marks the process failed and reads it back.
//
export function runMarkedFailed(context: ScenarioContext): void {
    markFailed();
    context.expect(readStatus() === "failed", "A process marked failed is to end in failure.");
}

//
// Reads the exit code in a run that set none, whatever the run before it set.
//
export function runUnmarked(context: ScenarioContext): void {
    context.expect(readStatus() === "clean", "A run starts with no exit code set.");
}
