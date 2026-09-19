// Scenarios for the module a run replaces in place of `node:net`.
//
// A made up call reaches each of these with whatever string it was handed. What they do next turns
// on whether the injector failed that call, and the injector is not an argument.

import type { Checklist, Injector } from "faultline";
import type { EffectName } from "../../runtime/index.ts";
import { runWith } from "../current.ts";
import { RunSubject } from "../subject.ts";
import net from "./net.ts";

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

// Every way a connection goes.
export async function everyWayAConnectionGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    for (const failure of [undefined, "refused", "timeout", "dns", "server-error", "bad-body"]) {
        await asking(failure === undefined ? undefined : "net", failure ?? "", async () => {
            await new Promise<void>((settle) => {
                const socket = net.connect(80, "example.com", () => undefined);
                socket.setTimeout();
                socket.setNoDelay();
                socket.on("data", () => undefined);
                socket.on("end", () => settle());
                socket.on("error", () => settle());
                socket.write();
            });
        });
    }
    net.createConnection().destroy();
    net.createConnection(80).end();
}

