//
// The scenario that says what `uname` prints, which no value can.
//

import type { ScenarioContext } from "faultline";
import { machineKind } from "./system.ts";

//
// A machine whose `uname` prints Darwin.
//
export function runOnMac(context: ScenarioContext): void {
    context.programs.answer("uname", { stdout: "Darwin\n", stderr: "", exitCode: 0 });
    context.expect(machineKind() === "mac", "A machine whose uname prints Darwin is a Mac.");
}
