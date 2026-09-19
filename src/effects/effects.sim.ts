// Scenarios for the effects a run owns.
//
// Every one of these answers one way until the injector says the call fails, and then it fails the
// way the real thing fails. Which failure is not an argument, so no made up call reaches them.

import type { Checklist, Injector } from "faultline";
import { CodedError, readsBeneath, RunClock, RunFiles, RunNet, RunWriter } from "./effects.ts";
import { RunInjector } from "./injector.ts";
import { SeededRng } from "./random.ts";

// An injector that fails the next call to `effect` with `failure`.
function asking(effect: Parameters<RunInjector["fail"]>[0], failure: string): RunInjector {
    const made = new RunInjector(new SeededRng(19), "clean");
    made.fail(effect, failure);
    return made;
}

// A clock that answers, one corrected backwards and one corrected forwards.
export async function everyWayTheClockGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const plain = new RunClock(new RunInjector(new SeededRng(19), "clean"));
    const before = plain.now();
    await plain.sleep(1000);
    if (plain.now() <= before) {
        throw new Error("TheClockDidNotMoveForwardWhenItWasWaitedOn");
    }
    if (plain.monotonic() <= 0) {
        throw new Error("TheMonotonicClockDidNotMove");
    }
    const backwards = new RunClock(asking("clock", "backwards"));
    if (backwards.now() >= new RunClock(new RunInjector(new SeededRng(19), "clean")).now()) {
        throw new Error("TheClockCorrectedBackwardsReadLater");
    }
    const jumped = new RunClock(asking("clock", "jump"));
    if (jumped.now() <= new RunClock(new RunInjector(new SeededRng(19), "clean")).now()) {
        throw new Error("TheClockCorrectedForwardsReadEarlier");
    }
}

// Every way a file call goes, and what a path the run was never told about holds.
export async function everyWayAFileCallGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const plain = new RunFiles(new RunInjector(new SeededRng(19), "clean"));
    await plain.write("/a/b/held.txt", "kept");
    if ((await plain.read("/a/b/held.txt")) !== "kept") {
        throw new Error("TheTreeDidNotKeepWhatItWasGiven");
    }
    if ((await plain.readBytes("/a/b/held.txt")).length === 0) {
        throw new Error("TheTreeHandedBackNoBytes");
    }
    if (!(await plain.exists("/a/b/held.txt"))) {
        throw new Error("TheTreeSaidWhatItHoldsIsNotThere");
    }
    if ((await plain.list("/a")).length === 0) {
        throw new Error("TheTreeListedNothingInADirectoryItHolds");
    }
    await plain.list("/");
    await plain.remove("/a/b/held.txt");
    plain.holds(["name", "at"], ["kept", 7], 1);
    plain.appendNow("/log.txt", "one\n");
    plain.appendNow("/log.txt", "two\n");
    plain.makeDirectoryNow("/c/d");
    plain.statNow("/c");
    plain.statNow("/log.txt");
    plain.renameNow("/log.txt", "/moved.txt");
    plain.holds([], []);

    for (const failure of ["missing", "denied", "io", "is-directory", "full"]) {
        const held = new RunFiles(asking("files", failure));
        let refused = false;
        try {
            await held.read("/settings.json");
        }
        catch (thrown) {
            refused = thrown instanceof CodedError;
        }
        if (!refused) {
            throw new Error(`TheReadDidNotFailWith_${failure}`);
        }
    }
    const unreadable = new RunFiles(asking("files", "unreadable"));
    if ((await unreadable.read("/settings.json")) === '{"name":"faultline","retries":3}') {
        throw new Error("TheUnreadableFileReadBackAsItself");
    }
    // A call the injector failed says the path is not there rather than throwing.
    if (await new RunFiles(asking("files", "missing")).exists("/settings.json")) {
        throw new Error("TheFailedStatSaidThePathIsThere");
    }
}

// Every way a request over the network goes.
export async function everyWayARequestGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const plain = new RunNet(new RunInjector(new SeededRng(19), "clean"), new SeededRng(19));
    const answer = await plain.fetch("https://example.com/thing");
    await answer.text();
    await plain.fetch(new URL("https://example.com/"), { method: "POST" });

    for (const failure of ["refused", "timeout", "dns"]) {
        let refused = false;
        try {
            await new RunNet(asking("net", failure), new SeededRng(19)).fetch("https://example.com/");
        }
        catch {
            refused = true;
        }
        if (!refused) {
            throw new Error(`TheRequestDidNotFailWith_${failure}`);
        }
    }
    const wrong = await new RunNet(asking("net", "server-error"), new SeededRng(19)).fetch("https://example.com/");
    if (wrong.ok) {
        throw new Error("TheServerErrorAnsweredThatAllWasWell");
    }
    const bad = await new RunNet(asking("net", "bad-body"), new SeededRng(19)).fetch("https://example.com/");
    let wouldNotParse = false;
    try {
        await bad.json();
    }
    catch {
        wouldNotParse = true;
    }
    if (!wouldNotParse) {
        throw new Error("TheBodyThatWillNotParseParsed");
    }
}

// Every way a write goes.
export async function everyWayAWriteGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const plain = new RunWriter(new RunInjector(new SeededRng(19), "clean"));
    if ((await plain.write("a line\n")) !== "a line\n".length) {
        throw new Error("TheWriterTookLessThanItWasGivenWithNothingWrong");
    }
    await plain.end();
    // A writer that has ended refuses what comes after it, the way the runtime refuses it.
    await assertThrows(() => plain.write("one more line\n"), "AWriterThatHadEndedTookAnotherLine");

    const short = new RunWriter(asking("writer", "short"));
    if ((await short.write("a line\n")) >= "a line\n".length) {
        throw new Error("TheShortWriteTookEverything");
    }
    for (const failure of ["closed", "broken-pipe"]) {
        let refused = false;
        try {
            await new RunWriter(asking("writer", failure)).write("a line\n");
        }
        catch {
            refused = true;
        }
        if (!refused) {
            throw new Error(`TheWriteDidNotFailWith_${failure}`);
        }
    }
}

// A run reading the disk under its own tree.
//
// Which disk a run reads is handed in rather than imported, because this file is bundled for a
// browser and a browser has no disk. One is handed in here, and what is on it decides what a read
// answers with, what a listing names and what a path is said to be.
export async function theDiskUnderARunsOwnTree(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const onIt: Record<string, string> = { "/held/a.txt": "what the disk holds\n" };
    readsBeneath({
        kind: (path) => {
            if (onIt[path] !== undefined) {
                return "file";
            }
            return path === "/held" ? "directory" : undefined;
        },
        file: (path) => onIt[path],
        names: (path) => (path === "/held" ? ["a.txt"] : undefined),
    });
    try {
        const clean = new RunInjector(new SeededRng(19), "clean");
        const files = new RunFiles(clean);

        if ((await files.read("/held/a.txt")) !== "what the disk holds\n") {
            throw new Error("AFileOnTheDiskWasNotReadBackFromIt");
        }
        if (!(await files.list("/held")).includes("a.txt")) {
            throw new Error("AFileOnTheDiskWasNotNamedInTheListing");
        }
        if (!files.statNow("/held").isDirectory) {
            throw new Error("ADirectoryOnTheDiskWasNotSaidToBeOne");
        }
        if (files.statNow("/held/a.txt").size === 0) {
            throw new Error("AFileOnTheDiskWasSaidToHoldNoBytes");
        }

        // A write goes to the run's own tree and the file on the disk is left as it was.
        await files.write("/held/a.txt", "what the run holds\n");
        if ((await files.read("/held/a.txt")) !== "what the run holds\n") {
            throw new Error("AWriteOverAFileOnTheDiskWasNotReadBack");
        }
        if (onIt["/held/a.txt"] !== "what the disk holds\n") {
            throw new Error("AWriteReachedTheDisk");
        }

        // A file taken away stays away, and the listing stops naming it.
        await files.remove("/held/a.txt");
        await assertThrows(() => files.read("/held/a.txt"), "AFileTakenAwayWasStillRead");
        if ((await files.list("/held")).includes("a.txt")) {
            throw new Error("AFileTakenAwayWasStillNamedInTheListing");
        }
        if (await files.exists("/held/a.txt")) {
            throw new Error("AFileTakenAwayWasStillThere");
        }
        // Adding to it makes it again, holding only what was added.
        files.appendNow("/held/a.txt", "written again\n");
        if ((await files.read("/held/a.txt")) !== "written again\n") {
            throw new Error("AFileMadeAgainByAddingToItWasNotReadBack");
        }

        // A path inside a directory the disk has and the run was never written to is a path the
        // project does not have.
        await assertThrows(() => files.read("/held/b.txt"), "APathTheProjectDoesNotHaveWasRead");
        await assertThrows(async () => files.statNow("/held/b.txt"), "APathTheProjectDoesNotHaveWasStated");
        await assertThrows(() => files.list("/held/b"), "ADirectoryTheProjectDoesNotHaveWasListed");

        // A path nowhere near the disk names a tree that is not on this machine, where every path
        // asked about is there.
        if ((await files.read("/made/up.json")).length === 0) {
            throw new Error("AMadeUpPathHeldNoText");
        }
        // A path directly under the root, which has no directory above it to ask about.
        if ((await files.read("/up.json")).length === 0) {
            throw new Error("APathUnderTheRootHeldNoText");
        }
        // A directory written with a slash on the end, which names the same directory without one.
        if (!(await files.list("/held/")).includes("a.txt")) {
            throw new Error("ADirectoryWrittenWithASlashOnTheEndNamedSomethingElse");
        }
    }
    finally {
        readsBeneath(undefined);
    }
}

// Runs `work` and throws `said` when it does not throw itself.
async function assertThrows(work: () => unknown, said: string): Promise<void> {
    try {
        await work();
    }
    catch {
        return;
    }
    throw new Error(said);
}
