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

// Runs `work` with one run in flight, queueing the named failure before each call rather than once
// for the lot, so every call is the one the injector fails.
async function eachAsking(failures: (string | undefined)[], work: (queue: () => void) => Promise<void> | void): Promise<void> {
    for (const failure of failures) {
        const subject = new RunSubject(13, "clean");
        const held = runWith(subject);
        try {
            await work(() => {
                if (failure !== undefined) {
                    subject.injector.fail("process", failure);
                }
            });
        }
        finally {
            runWith(held);
        }
    }
}

// Every way a started program goes, for every call that starts one.
export async function everyWayAProgramGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const ways = [undefined, "missing", "denied", "failed", "on-error-stream"];
    await eachAsking(ways, (queue) => {
        queue();
        try {
            child.execSync("git --version");
        }
        catch {
            // The injector decides, and the scenario is that each way runs.
        }
        queue();
        try {
            child.execFileSync("git");
        }
        catch {
            // The same.
        }
        queue();
        child.spawnSync("git");
    });

    // A program that will not start emits an error, which the runtime ends the process over when
    // no listener is there for it, so each of these listens the way a caller has to.
    await eachAsking(ways, async (queue) => {
        queue();
        await new Promise<void>((settle) => {
            child.exec("git --version", {}, () => settle()).on("error", () => undefined);
        });
        queue();
        await new Promise<void>((settle) => {
            child.execFile("git", () => settle()).on("error", () => undefined);
        });
    });

    await eachAsking(ways, async (queue) => {
        queue();
        await new Promise<void>((settle) => {
            const started = child.spawn("git");
            started.on("error", () => settle());
            started.on("close", () => settle());
            started.kill();
        });
    });

    // A call given something other than a function where the callback goes, and one given none.
    await eachAsking([undefined], (queue) => {
        queue();
        child.exec("git --version").on("error", () => undefined);
        child.execFile("git", {}, "not a function").on("error", () => undefined);
    });
}

// A forked program, which says what the run made up to whoever is listening.
export async function aForkedProgramSaysWhatItHasToSay(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const subject = new RunSubject(13, "clean");
    subject.events.holds(["type", "index"], ["ready", "unit", 1]);
    const held = runWith(subject);
    try {
        let said = 0;
        await new Promise<void>((settle) => {
            const forked = child.fork("./a.mjs") as unknown as {
                send: (message: unknown) => boolean;
                disconnect: () => void;
                on: (name: string, work: (message: unknown) => void) => void;
            };
            forked.on("message", () => {
                said += 1;
                // Every handler of a made up message throws here, and the ones after it are still
                // sent.
                throw new Error("ThisHandlerThrowsOnPurpose");
            });
            forked.on("close", () => settle());
            forked.send({});
            forked.disconnect();
        });
        if (said === 0) {
            throw new Error("AForkedProgramSaidNothingAtAll");
        }

        // A forked program nobody is listening to says nothing.
        await new Promise<void>((settle) => {
            const quiet = child.fork("./b.mjs");
            quiet.on("close", () => settle());
        });
    }
    finally {
        runWith(held);
    }
}
