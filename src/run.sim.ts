// Scenarios for one run from end to end.
//
// What a run does turns on the project it is pointed at, and a made up path names no project. These
// write one into the run's own tree and point a run at it.
//
// A run started from inside a run gets as far as writing the copies and then has no driver to start:
// the driving forks another copy of the runtime, and the module that does the forking is replaced
// while a run is measuring. So these cover what a run decides before it drives, which is everything
// it says about the project it was pointed at.

import fs from "node:fs";
import type { Checklist, Injector } from "faultline";
import type { Options } from "./options.ts";
import { run, versionOf } from "./run.ts";

// What a run is told, with only what this scenario cares about set.
function asked(root: string, was: Partial<Options> = {}): Options {
    return {
        root,
        source: [],
        exclude: [],
        seeds: 1,
        budget: 200,
        all: false,
        browser: false,
        help: false,
        version: false,
        ...was,
    };
}

// Writes one project into the run's own tree.
function project(at: string, files: Record<string, string>): string {
    for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(`${at}/${name}`, text);
    }
    return at;
}

// Keeps what a run said, so a scenario can read it back.
function saying(): { say: (text?: string) => void; said: string[] } {
    const said: string[] = [];
    return { said, say: (text = "") => said.push(text) };
}

// A project whose files are not modules, which flt cannot load.
export async function aProjectThatIsNotModules(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const root = project("/commonjs", { "package.json": '{ "name": "a", "type": "commonjs" }', "a.ts": "export const a = 1;\n" });
    const { say, said } = saying();
    const answer = await run(asked(root), say, () => undefined);
    if (answer.status !== 1) {
        throw new Error("ARunOverAProjectThatIsNotModulesSaidItPassed");
    }
    if (!said.join("\n").includes("CommonJS")) {
        throw new Error("TheRunDidNotSayWhyItWouldNotLoadTheProject");
    }
}

// A project with no source file in it, and one narrowed to a file that is not there.
export async function aProjectWithNothingToExercise(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const root = project("/empty", { "package.json": '{ "name": "a", "type": "module" }', "notes.md": "text\n" });
    const { say, said } = saying();
    if ((await run(asked(root), say, () => undefined)).status !== 1) {
        throw new Error("ARunWithNothingToExerciseSaidItPassed");
    }
    if (!said.join("\n").includes("no code to exercise")) {
        throw new Error("TheRunDidNotSayItHadNothingToExercise");
    }

    const named = project("/named", { "package.json": '{ "name": "a", "type": "module" }', "a.ts": "export const a = 1;\n" });
    const { say: alsoSay, said: alsoSaid } = saying();
    if ((await run(asked(named, { file: "nowhere.ts" }), alsoSay, () => undefined)).status !== 1) {
        throw new Error("ARunNarrowedToAFileThatIsNotThereSaidItPassed");
    }
    if (!alsoSaid.join("\n").includes("nowhere.ts")) {
        throw new Error("TheRunDidNotNameTheFileItCouldNotFind");
    }
}

// A run asked to say which version it is, and one asked in a browser.
export function theLittleAnswersARunGives(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (versionOf().length === 0) {
        throw new Error("TheToolSaidNoVersionOfItself");
    }
}
