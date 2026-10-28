//
// The scenario that starts the file as the one that was run, which loading it never does.
//

import type { ScenarioContext } from "faultline";

//
// Starts the file as the process's entry point.
//
export async function runAsEntryPoint(context: ScenarioContext): Promise<void> {
    const started = await context.start("src/cli.ts");
    context.expect(started.reachedAs === "run", "A file started as the entry point knows it was run.");
}
