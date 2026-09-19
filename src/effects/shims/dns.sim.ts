// Scenarios for the module a run replaces in place of `node:dns`.
//
// A made up call reaches each of these with whatever string it was handed. What they do next turns
// on whether the injector failed that call, and the injector is not an argument.

import type { Checklist, Injector } from "faultline";
import type { EffectName } from "../../runtime/index.ts";
import { runWith } from "../current.ts";
import { RunSubject } from "../subject.ts";
import dns from "./dns.ts";

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

// Every way a lookup goes, through both the callback and the promise.
export async function everyWayALookupGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    for (const failure of [undefined, "dns", "timeout", "refused", "server-error", "bad-body"]) {
        await asking(failure === undefined ? undefined : "net", failure ?? "", async () => {
            await new Promise<void>((settle) => dns.lookup("example.com", {}, () => settle()));
        });
        await asking(failure === undefined ? undefined : "net", failure ?? "", async () => {
            await new Promise<void>((settle) => dns.resolve("example.com", () => settle()));
        });
        await asking(failure === undefined ? undefined : "net", failure ?? "", async () => {
            try {
                await dns.promises.lookup("example.com");
                await dns.promises.resolve("example.com");
                await dns.promises.resolve4("example.com");
            }
            catch {
                // Which of them fails is the injector's, and the scenario is that each way runs.
            }
        });
    }
    dns.lookup("example.com", () => undefined);
    dns.resolve4("example.com", undefined);
}

