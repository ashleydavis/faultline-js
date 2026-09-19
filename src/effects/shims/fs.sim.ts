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

// The calls a run answers but does nothing with, and the ones that hand back a stream.
//
// Every one of them reaches a disk when it is the real thing, and a run makes up the path it is
// given, so none of them may be the real thing while a run is driving.
export async function theCallsThatReachADiskAndAreStopped(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    await asking(undefined, "", async () => {
        files.writeFileSync("/streamed.txt", "one\ntwo\n");

        // The entries of a directory rather than the names, which is how anything walking a tree
        // asks. The names alone broke every walk.
        files.mkdirSync("/tree/inside");
        files.writeFileSync("/tree/held.txt", "kept");
        const entries = files.readdirSync("/tree", { withFileTypes: true });
        if (entries.length === 0) {
            throw new Error("TheDirectoryHadNoEntries");
        }
        for (const entry of entries as { name: string; isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean; parentPath: string }[]) {
            entry.isFile();
            entry.isDirectory();
            entry.isSymbolicLink();
            if (entry.name.length === 0 || entry.parentPath.length === 0) {
                throw new Error("AnEntrySaidNothingAboutItself");
            }
        }
        await files.promises.readdir("/tree", { withFileTypes: true });

        // Every call that reaches a disk and is answered with nothing, so the code after it runs.
        files.chownSync();
        files.chmodSync();
        files.closeSync();
        files.cpSync();
        files.fchownSync();
        files.fchmodSync();
        files.fdatasyncSync();
        files.fsyncSync();
        files.ftruncateSync();
        files.futimesSync();
        files.lchownSync();
        files.linkSync();
        files.lutimesSync();
        files.rmdirSync();
        files.symlinkSync();
        files.truncateSync();
        files.utimesSync();
        files.unwatchFile();
        files.writeSync();
        files.writevSync();
        files.readSync();
        files.readvSync();
        files.openSync();
        files.mkdtempSync("/made-");
        files.realpathSync("/streamed.txt");
        files.readlinkSync("/streamed.txt");
        files.globSync();
        files.statfsSync();
        files.fstatSync().isFile();
        files.opendirSync("/tree").read();
        files.opendirSync("/tree").close();
        // Walked the way a caller that asks for one entry at a time walks it.
        for await (const entry of files.opendirSync("/tree")) {
            void entry;
        }
        // A directory named with a slash on the end, which is the same directory.
        files.readdirSync("/tree/", { withFileTypes: true });

        // The same calls written the way a caller that hands in a callback writes them, and once
        // more with something that is not a callback at all.
        for (const held of [files.chown, files.chmod, files.close, files.cp, files.fchown, files.fchmod, files.fdatasync, files.fsync, files.ftruncate, files.futimes, files.lchown, files.link, files.lutimes, files.rmdir, files.symlink, files.truncate, files.utimes, files.write, files.writev, files.read, files.readv, files.open, files.mkdtemp, files.realpath, files.readlink, files.glob, files.statfs, files.fstat, files.lstat, files.watch, files.watchFile, files.opendir, files.openAsBlob]) {
            await new Promise<void>((settle) => (held as (...args: unknown[]) => void)("/streamed.txt", () => settle()));
            (held as (...args: unknown[]) => void)("/streamed.txt", "not a callback");
        }

        // A file read and written as a stream, neither of which reaches a disk.
        const read = files.createReadStream("/streamed.txt") as unknown as AsyncIterable<unknown>;
        let held = "";
        for await (const piece of read) {
            held += String(piece);
        }
        if (!held.startsWith("one")) {
            throw new Error("TheStreamHandedBackSomethingElse");
        }
        const written = files.createWriteStream("/written.txt") as unknown as { write: (text: string) => void; end: () => void };
        written.write("one\n");
        written.write("two\n");
        written.end();
        if (!files.readFileSync("/written.txt", "utf8").toString().includes("two")) {
            throw new Error("WhatWasWrittenToTheStreamWasNotKept");
        }
    });

    // A read the injector fails hands back an empty stream rather than one that never ends.
    await asking("files", "missing", () => {
        files.createReadStream("/streamed.txt");
    });

    // A call through a callback that fails, so the callback is told rather than the call throwing.
    await asking("files", "denied", async () => {
        const thrown = await new Promise<{ code?: string }>((settle) => files.readFile("/settings.json", "utf8", (error: unknown) => settle(error as { code?: string })));
        if (thrown.code !== "EACCES") {
            throw new Error("TheCallbackWasNotToldWhyTheReadFailed");
        }
    });
}
