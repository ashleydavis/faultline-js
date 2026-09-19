// Scenarios for the command line.
//
// What the command line does turns on the project it is pointed at and on whether it is printing to
// a terminal, and neither is a made up value. These write a project into the run's own tree, point
// the command line at it, and say it is printing to a terminal so the progress line is written.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Checklist, Injector } from "faultline";
import { main } from "./cli.ts";

// One source file with a branch in it, so the run has something to exercise.
const oneFunction = "export function greet(name: string) {\n    if (name.length > 2) {\n        return 1;\n    }\n    return 0;\n}\n";

// Writes a project into the run's own tree, with a driver where a copy of the tool looks for one.
//
// The driver written never runs: the module that forks is replaced while a run is measuring, so the
// driver the command line starts says at once that it ran out of work.
function project(at: string): string {
    fs.writeFileSync(fileURLToPath(new URL("./drive/child.ts", import.meta.url)), "");
    fs.writeFileSync(`${at}/package.json`, '{ "name": "a", "type": "module" }');
    fs.writeFileSync(`${at}/a.ts`, oneFunction);
    return at;
}

// What the command line says when it is asked what it is and what it takes.
export async function whatTheCommandLineSaysAboutItself(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    if ((await main(["--version"], "/asked")) !== 0) {
        throw new Error("TheToolAskedForItsVersionDidNotExitZero");
    }
    if ((await main([], "/asked")) !== 0) {
        throw new Error("TheToolAskedForNothingDidNotExitZero");
    }
    if ((await main(["--made-up"], "/asked")) !== 2) {
        throw new Error("TheToolGivenAnOptionItHasNoNameForDidNotRefuseIt");
    }
}

// A whole run from the command line, printing to a terminal, so the progress line is written and
// taken away again.
export async function aRunPrintingToATerminal(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const root = project("/at-the-terminal");
    const out = process.stdout as { isTTY?: boolean };
    const before = out.isTTY;
    out.isTTY = true;
    try {
        await main([root, "--seeds", "1", "--budget", "200"], root);
    }
    finally {
        out.isTTY = before;
    }
}

// The same run with its output being collected, which prints no progress line at all.
export async function aRunWhoseOutputIsCollected(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const root = project("/collected");
    const out = process.stdout as { isTTY?: boolean };
    const before = out.isTTY;
    out.isTTY = false;
    try {
        await main([root, "--seeds", "1", "--budget", "200"], root);
    }
    finally {
        out.isTTY = before;
    }
}
