// Scenarios for reading what a run was asked for.
//
// A made up list of strings is nearly never a command line, so the arguments a run is given are
// written out here.

import type { Checklist, Injector } from "faultline";
import { readOptions } from "./options.ts";

// Every option a run takes.
export function everyOptionARunTakes(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const held = readOptions(
        [
            "somewhere",
            "--source", "src",
            "--source", "lib",
            "--exclude", "vendor",
            "--exclude", "out",
            "--file", "src/a.ts",
            "--function", "held",
            "--seeds", "8",
            "--budget", "2000",
            "--report", "/tmp/held.txt",
            "--replay", "seed=7",
            "--all",
            "--browser",
            "--chromium", "/opt/chrome",
        ],
        "/from",
    );
    if (held.source.length !== 2 || held.exclude.length !== 2) {
        throw new Error("TheOptionsGivenTwiceWereNotBothKept");
    }
    if (held.seeds !== 8 || held.budget !== 2000) {
        throw new Error("TheNumbersWereNotRead");
    }
    if (!held.all || !held.browser) {
        throw new Error("TheOptionsWithNoValueWereNotRead");
    }
    if (held.replay?.seed !== 7) {
        throw new Error("ThePlanToReplayWasNotRead");
    }

    // The ones that say something and stop.
    if (!readOptions(["--help"], "/from").help) {
        throw new Error("TheRunWasNotAskedForHelp");
    }
    if (!readOptions(["--version"], "/from").version) {
        throw new Error("TheRunWasNotAskedForTheVersion");
    }
    // Written with an equals sign rather than a space, and with no directory named at all.
    readOptions(["--seeds=8", "--source=src"], "/from");
    readOptions([], "/from");
}

// Every command line the reader refuses, because a run driven by something it did not understand
// drives something other than what was asked for.
export function everyCommandLineTheReaderRefuses(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const refused = [
        ["--made-up"],
        ["--seeds"],
        ["--seeds", "not-a-number"],
        ["--seeds", "0"],
        ["--budget", "not-a-number"],
        ["--source"],
        ["--replay", "made up"],
        ["one", "two"],
    ];
    for (const one of refused) {
        let said = false;
        try {
            readOptions(one, "/from");
        }
        catch {
            said = true;
        }
        if (!said) {
            throw new Error(`TheReaderTook_${one.join(" ")}_WhichItShouldRefuse`);
        }
    }
}
