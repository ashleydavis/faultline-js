// Scenarios for the module a run replaces in place of `node:child_process`.
//
// A made up call reaches each of these with whatever string it was handed. What they do next turns
// on whether the injector failed that call, and the injector is not an argument.

import type { Checklist, Injector } from "faultline";
import type { EffectName } from "../../runtime/index.ts";
import { runWith } from "../current.ts";
import { RunSubject } from "../subject.ts";
import child from "./child-process.ts";

// Runs `work` with one run in flight and one named failure queued, so the next call to that effect
// gets it.
async function asking(effect: EffectName | undefined, failure: string, work: () => Promise<void> | void): Promise<void> {
    const subject = new RunSubject(13, "clean");
    if (effect !== undefined) {
        subject.injector.fail(effect, failure);
    }
    const held = runWith(subject);
    try {
        await work();
    }
    finally {
        runWith(held);
    }
}

// Every way a started program goes.
export async function everyWayAProgramGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    for (const failure of [undefined, "missing", "denied", "failed", "on-error-stream"]) {
        await asking(failure === undefined ? undefined : "process", failure ?? "", async () => {
            try {
                child.execSync("git --version");
                child.execFileSync("git");
            }
            catch {
                // The injector decides, and the scenario is that each way runs.
            }
            await new Promise<void>((settle) => {
                child.exec("git --version", {}, () => settle());
            });
            await new Promise<void>((settle) => {
                const started = child.spawn("git");
                started.on("error", () => settle());
                started.on("close", () => settle());
                started.kill();
            });
            child.execFile("git", () => undefined);
            child.spawnSync("git");
            const forked = child.fork("./a.mjs") as unknown as { send: (m: unknown) => boolean; disconnect: () => void };
            forked.send({});
            forked.disconnect();
        });
    }
    child.exec("git --version");
}

