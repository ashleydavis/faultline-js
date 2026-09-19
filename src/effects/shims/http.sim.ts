// Scenarios for the module a run replaces in place of `node:http`.
//
// A made up call reaches each of these with whatever string it was handed. What they do next turns
// on whether the injector failed that call, and the injector is not an argument.

import type { Checklist, Injector } from "faultline";
import type { EffectName } from "../../runtime/index.ts";
import { runWith } from "../current.ts";
import { RunSubject } from "../subject.ts";
import http, { type IncomingMessage } from "./http.ts";
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

// Every way a request can go: answering, refused, timed out, resolving no name, answering with an
// error, and answering with a body that will not parse.
export async function everyWayARequestGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    for (const failure of [undefined, "refused", "timeout", "dns", "server-error", "bad-body"]) {
        await asking(failure === undefined ? undefined : "net", failure ?? "", async () => {
            await new Promise<void>((settle) => {
                const asked = http.request("http://example.com/thing", {}, (answer: IncomingMessage) => {
                    answer.on("data", () => undefined);
                    answer.on("end", () => settle());
                });
                asked.on("error", () => settle());
                asked.setTimeout();
                asked.write();
                asked.end();
                asked.end();
            });
        });
    }
    http.get(new URL("http://example.com/"), () => undefined).destroy();
    http.get({ hostname: "example.com", port: 80 }, () => undefined);
    http.get("not a url at all", () => undefined);
}

// A server the code under test makes listens on nothing and says it is up.
export async function aServerListensOnNothing(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    await asking(undefined, "", async () => {
        await new Promise<void>((settle) => {
            const made = http.createServer({}, () => undefined);
            made.on("listening", () => {
                if (made.address().port !== 0) {
                    throw new Error("TheServerTookAnAddressOfItsOwn");
                }
                made.close(() => settle());
            });
            made.listen(0);
        });
        http.createServer(() => undefined).listen();
        net.createServer(() => undefined).listen(0, () => undefined).close();
        net.createServer().close(() => undefined).address();
    });
}

