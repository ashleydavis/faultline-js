//
// Code that runs a program and reads what it printed, which is what a program answer is for.
//

import { execFileSync } from "node:child_process";

//
// The kind of machine `uname` says this is.
//
export function machineKind(): string {
    const printed = execFileSync("uname", [], { encoding: "utf8" });
    if (printed.trim() === "Darwin") {
        return "mac";
    }
    return "other";
}
