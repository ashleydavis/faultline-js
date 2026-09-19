// Scenarios for the effects a run owns.
//
// Every one of these answers one way until the injector says the call fails, and then it fails the
// way the real thing fails. Which failure is not an argument, so no made up call reaches them.

import type { Checklist, Injector } from "faultline";
import { CodedError, RunClock, RunFiles, RunNet, RunWriter } from "./effects.ts";
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
