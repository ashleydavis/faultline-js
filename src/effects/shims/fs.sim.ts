// Scenarios for the module a run replaces in place of `node:fs`.
//
// A made up call reaches each of these with whatever string it was handed. What they do next turns
// on whether the injector failed that call, and the injector is not an argument.

import type { Checklist, Injector } from "faultline";
import type { EffectName } from "../../runtime/index.ts";
import { runWith } from "../current.ts";
import { RunSubject } from "../subject.ts";
import files from "./fs.ts";

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

// Every way a file call goes, through the calls that take a callback as well as the ones that do
// not.
export async function everyWayAFileCallGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    for (const failure of [undefined, "missing", "denied", "io", "is-directory", "full", "unreadable"]) {
        await asking(failure === undefined ? undefined : "files", failure ?? "", async () => {
            try {
                files.readFileSync("/settings.json", "utf8");
                files.readFileSync("/settings.json");
                files.writeFileSync("/a/b/held.txt", "kept");
                files.writeFileSync("/a/b/held.txt", new TextEncoder().encode("kept"));
                files.appendFileSync("/a/b/held.txt", "more");
                files.existsSync("/a/b/held.txt");
                files.readdirSync("/a");
                files.mkdirSync("/c", { recursive: true });
                files.statSync("/a/b/held.txt");
                files.statSync("/c");
                files.lstatSync("/settings.json");
                files.accessSync("/settings.json");
                files.copyFileSync("/settings.json", "/copy.json");
                files.renameSync("/copy.json", "/moved.json");
                files.rmSync("/moved.json");
                files.unlinkSync("/a/b/held.txt");
            }
            catch {
                // Which one fails is the injector's, and the scenario is that each way runs.
            }
            await new Promise<void>((settle) => files.readFile("/settings.json", "utf8", () => settle()));
            await new Promise<void>((settle) => files.readFile("/settings.json", () => settle()));
            await new Promise<void>((settle) => files.writeFile("/w.txt", "x", {}, () => settle()));
            await new Promise<void>((settle) => files.appendFile("/w.txt", "y", {}, () => settle()));
            await new Promise<void>((settle) => files.readdir("/", {}, () => settle()));
            await new Promise<void>((settle) => files.mkdir("/d", {}, () => settle()));
            await new Promise<void>((settle) => files.stat("/w.txt", {}, () => settle()));
            await new Promise<void>((settle) => files.access("/w.txt", 0, () => settle()));
            await new Promise<void>((settle) => files.rename("/w.txt", "/v.txt", () => settle()));
            await new Promise<void>((settle) => files.copyFile("/v.txt", "/u.txt", () => settle()));
            await new Promise<void>((settle) => files.rm("/u.txt", {}, () => settle()));
            await new Promise<void>((settle) => files.unlink("/v.txt", () => settle()));
            await files.promises.writeFile("/p.txt", "x");
            await files.promises.appendFile("/p.txt", "y");
            await files.promises.readFile("/p.txt", "utf8");
            await files.promises.readdir("/");
            await files.promises.mkdir("/e");
            await files.promises.stat("/p.txt");
            await files.promises.lstat("/p.txt");
            await files.promises.access("/p.txt");
            await files.promises.copyFile("/p.txt", "/q.txt");
            await files.promises.rename("/q.txt", "/r.txt");
            await files.promises.rm("/r.txt");
            await files.promises.unlink("/p.txt");
        });
    }
    // A callback that is not a function is what a made up call hands in, and it is answered with
    // nothing rather than being called.
    files.readFile("/settings.json", "utf8", {});
    files.exists("/settings.json", () => undefined);
    files.exists("/settings.json", {});
}
