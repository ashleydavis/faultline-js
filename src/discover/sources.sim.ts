// Scenarios for walking a tree to find the files a run exercises.
//
// A walk turns on what is in the tree, and a made up path names nothing in particular. These write
// a tree first and then walk it. The tree is the run's own, held in memory, so nothing here reaches
// a disk.

import fs from "node:fs";
import type { Checklist, Injector } from "faultline";
import { isDeclarationFile, isSimFile, isTestFile, simFileFor, toPosix, walkSources } from "./sources.ts";

// Writes one tree and hands back where it is.
function tree(at: string, files: Record<string, string>): string {
    for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(`${at}/${name}`, text);
    }
    return at;
}

// A tree holding one of everything a walk has something to say about.
export function aTreeOfEveryKindOfFile(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const root = tree("/project", {
        "package.json": "{}",
        "src/one.ts": "export function a() { return 1; }\n",
        "src/one.sim.ts": "export function f() { return 1; }\n",
        "src/one.test.ts": "export function t() { return 1; }\n",
        "src/held.d.ts": "export declare function d(): void;\n",
        "src/two.tsx": "export function b() { return 1; }\n",
        "src/three.js": "export function c() { return 1; }\n",
        "src/notes.md": "text\n",
        "src/deep/four.mts": "export function d() { return 1; }\n",
        "node_modules/somebody/five.ts": "export function e() { return 1; }\n",
        "dist/six.js": "export function f() { return 1; }\n",
        "left-out/seven.ts": "export function g() { return 1; }\n",
    });

    // A link sitting where a source file would sit. It is neither a file nor a directory, which is
    // what a walk steps over, and a tree kept under version control has them.
    fs.symlinkSync(`${root}/src/one.ts`, `${root}/src/linked.ts`);

    // One name is a directory anywhere in the tree and the other is one file by its path, which is
    // how an entry point that starts a run of its own is left out.
    const walked = walkSources({ root, source: [], exclude: ["left-out", "src/three.js"] });
    if (walked.sources.some((one) => one.file.endsWith("three.js"))) {
        throw new Error("TheWalkTookAFileItWasToldToLeaveOut");
    }
    if (walked.sources.some((one) => one.file.endsWith("linked.ts"))) {
        throw new Error("TheWalkTookALinkAsASourceFile");
    }
    if (!walked.sources.some((one) => one.file.endsWith("one.ts"))) {
        throw new Error("TheWalkMissedTheSourceFile");
    }
    if (walked.sources.some((one) => one.file.includes("node_modules"))) {
        throw new Error("TheWalkWentIntoSomebodyElsesCode");
    }
    if (walked.sources.some((one) => one.file.includes("left-out"))) {
        throw new Error("TheWalkWentIntoWhatItWasToldToLeaveOut");
    }
    if (walked.sources.some((one) => isSimFile(one.file) || isTestFile(one.file) || isDeclarationFile(one.file))) {
        throw new Error("TheWalkTookAFileThatIsAHarnessRatherThanCode");
    }
    if (walked.sims.size === 0) {
        throw new Error("TheWalkDidNotFindTheSimFileBesideTheSource");
    }
    if (walked.skipped.length === 0) {
        throw new Error("TheWalkSaidItSkippedNothing");
    }
}

// The walk told which directories to take, and one told to take a file rather than a directory.
export function aWalkToldWhereToLook(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const root = tree("/named", {
        "a/one.ts": "export function a() { return 1; }\n",
        "b/two.ts": "export function b() { return 1; }\n",
    });
    const only = walkSources({ root, source: ["a"], exclude: [] });
    if (only.sources.some((one) => one.file.startsWith("b/"))) {
        throw new Error("TheWalkTookADirectoryItWasNotToldTo");
    }
    walkSources({ root, source: ["a", "b"], exclude: [] });
    walkSources({ root, source: ["a/one.ts"], exclude: [] });
    walkSources({ root, source: ["nowhere-at-all"], exclude: [] });
    walkSources({ root, source: [], exclude: ["a/one.ts"] });
}

// The little answers a walk gives about one name.
export function whatAWalkSaysAboutOneName(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    for (const one of ["a.ts", "a.sim.ts", "a.test.ts", "a.spec.ts", "a.d.ts", "a.mts", "a.cjs", "a.tsx", "a"]) {
        isSimFile(one);
        isTestFile(one);
        isDeclarationFile(one);
        simFileFor(one);
        toPosix(one);
    }
    toPosix("a\\b\\c.ts");
}
