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
import { fileURLToPath } from "node:url";
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

// One source file with a branch in it, for a run that goes the whole way.
const oneFunction = "export function greet(name: string) {\n    if (name.length > 2) {\n        return 1;\n    }\n    return 0;\n}\n";

// A second source file, so a run reports more than one of everything.
const twoFunctions = "export function first(at: number) {\n    return at + 1;\n}\n\nexport function second(at: number) {\n    return at - 1;\n}\n";

// Where the run being measured looks for the runtime module, which is how a parameter of an effect
// type is told from one whose type merely carries the same name.
//
// A copy of the tool has no runtime module beside it, so one is written there and the sim file
// below imports its types from where it was written.
function runtimeWritten(): string {
    const where = fileURLToPath(new URL("./runtime/index.ts", import.meta.url));
    fs.writeFileSync(
        where,
        [
            "export interface Injector {",
            "    fail(effect: string, failure: string): void;",
            "    failures(effect: string): string[];",
            "    clear(): void;",
            "}",
            "",
            "export interface Checklist {",
            "    ticked(name: string): boolean;",
            "    names(): string[];",
            "}",
            "",
        ].join("\n"),
    );
    return where;
}

// A sim file beside the first, holding a test input factory, a scenario and an invariant.
function oneSimFile(runtime: string): string {
    return [
        `import type { Checklist, Injector } from "${runtime}";`,
        "",
        "export function aName(): string {",
        '    return "a name";',
        "}",
        "",
        "export function greetingCountsTheName(injector: Injector, checklist: Checklist): void {",
        "    void injector;",
        "    void checklist;",
        "}",
        "",
        "export function everyGreetingIsCounted(): void {",
        "    void 0;",
        "}",
        "",
    ].join("\n");
}

// Puts a driver where a run looks for one.
//
// The driver sits beside the module that starts it, and a copy of the tool has no driver beside it.
// The one this writes never runs: the module that forks is replaced while a run is measuring, so
// the driver a run starts says at once that it ran out of work.
function driverBeside(): void {
    fs.writeFileSync(fileURLToPath(new URL("./drive/child.ts", import.meta.url)), "");
}

// A whole run over a project with two source files and a sim file beside one of them, from the walk
// to the report.
export async function aWholeRunOverAProject(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    driverBeside();
    const root = project("/whole", {
        "package.json": '{ "name": "a", "type": "module" }',
        "a.ts": oneFunction,
        "a.sim.ts": oneSimFile(runtimeWritten()),
        "b.ts": twoFunctions,
    });
    // Run again and again, because a driver says something different each time it is started, and
    // what a run says about how it went turns on what its driver said.
    let told = 0;
    for (let at = 0; at < runsDriven; at += 1) {
        const { say, said } = saying();
        await run(asked(root, { all: true }), say, (text = "") => {
            void text;
            told += 1;
        });
        if (said.length === 0) {
            throw new Error("TheRunSaidNothingAtAll");
        }
    }
    void told;
}

// How many times a scenario drives the same run. Each driver says something different, and a run
// says how it went from the first thing its driver said that it knows what to do with, so this is
// how many of those a scenario listens to. Two dozen is more than the number of things a driver
// has to say.
const runsDriven = 24;

// A run narrowed to one function, and one told where to put its full list.
export async function aRunNarrowedToOneFunction(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    driverBeside();
    const root = project("/narrowed", { "package.json": '{ "name": "a", "type": "module" }', "a.ts": oneFunction, "b.ts": twoFunctions });
    const { say } = saying();
    await run(asked(root, { fn: "greet", report: "/narrowed-report.txt" }), say, () => undefined);
    if (!fs.existsSync("/narrowed-report.txt")) {
        throw new Error("TheRunPutNoFullListWhereItWasToldTo");
    }

    const { say: alsoSay } = saying();
    await run(asked(root, { fn: "a.ts#greet" }), alsoSay, () => undefined);
}

// A replay of one seed, which drives and says how that one run went rather than reporting coverage.
export async function aReplayOfOneSeed(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    driverBeside();
    const root = project("/replayed", { "package.json": '{ "name": "a", "type": "module" }', "a.ts": oneFunction });
    // Replayed again and again, for the same reason a whole run is driven again and again.
    for (let at = 0; at < runsDriven; at += 1) {
        const { say, said } = saying();
        await run(asked(root, { replay: { seed: 1, fn: "a.ts#greet" } }), say, () => undefined);
        if (!said.join("\n").includes("replay")) {
            throw new Error("TheReplayDidNotSayHowItWent");
        }
    }
}

// A project the compiler will not take, which stops the run before anything is driven.
export async function aProjectThatWillNotCompile(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const root = project("/broken", { "package.json": '{ "name": "a", "type": "module" }', "a.ts": "export function greet( {\n" });
    const { say, said } = saying();
    if ((await run(asked(root), say, () => undefined)).status !== 1) {
        throw new Error("ARunOverAProjectThatWillNotCompileSaidItPassed");
    }
    if (!said.join("\n").includes("would not compile")) {
        throw new Error("TheRunDidNotSayTheProjectWouldNotCompile");
    }
}

// A run whose driver will not start, which is what a machine that cannot start a process does.
export async function aRunWhoseDriverWillNotStart(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    driverBeside();
    const root = project("/unstartable", { "package.json": '{ "name": "a", "type": "module" }', "a.ts": oneFunction });
    const { say, said } = saying();
    injector.fail("process", "missing");
    if ((await run(asked(root), say, () => undefined)).status !== 1) {
        throw new Error("ARunWhoseDriverWouldNotStartSaidItPassed");
    }
    if (!said.join("\n").includes("would not run")) {
        throw new Error("TheRunDidNotSayItsDriverWouldNotStart");
    }
}

// One run driven in a page, with the page saying what this scenario tells it to.
//
// The driver a page loads is written here rather than being the tool's own, because what is under
// test is what a run says about how it went, not what a page does once it is driving.
async function drivenInAPage(root: string, was: Partial<Options> = {}): Promise<string[]> {
    fs.writeFileSync(
        fileURLToPath(new URL("./drive/page.ts", import.meta.url)),
        [
            "export async function driveInPage(model, units, ticked) {",
            "    void units; void ticked;",
            '    if (model.root.endsWith("-scenario-failed")) {',
            '        return [{ type: "failed", seed: 1, where: "a.ts greet", error: "TheAnswerWasWrong", kind: "scenario" }];',
            "    }",
            '    if (model.root.endsWith("-invariant-failed")) {',
            '        return [{ type: "failed", seed: 1, where: "a.sim.ts everyGreetingIsCounted", error: "TheInvariantStoppedHolding", kind: "invariant" }];',
            "    }",
            '    if (model.root.endsWith("-broke")) {',
            '        return [{ type: "broke", error: "TheModuleWouldNotLoad" }];',
            "    }",
            '    return [{ type: "unit", index: 0, calls: 1, stepped: 0, fn: "a.ts#greet" }, { type: "finished" }];',
            "}",
            "",
        ].join("\n"),
    );

    project(root, { "package.json": '{ "name": "a", "type": "module" }', "a.ts": oneFunction });
    const { say, said } = saying();
    await run(asked(root, { browser: true, chromium: process.env.FAULTLINE_CHROMIUM, ...was }), say, () => undefined);
    return said;
}

// A run driven in a page, where the page says a unit is done and then that it has finished.
export async function aRunDrivenInAPage(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const said = (await drivenInAPage("/page-ran")).join("\n");
    if (!said.includes("Coverage:") && !said.includes("would not run")) {
        throw new Error("ARunDrivenInAPageSaidNeitherWhatItCoveredNorWhyItCouldNot");
    }
}

// A run whose page says a scenario gave a wrong answer, and one whose page says an invariant
// stopped holding.
export async function aRunInAPageThatCameBackWithSomethingWrong(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    for (const root of ["/page-scenario-failed", "/page-invariant-failed"]) {
        const said = (await drivenInAPage(root)).join("\n");
        if (!said.includes("Reproduce it with") && !said.includes("would not run")) {
            throw new Error("ARunWhosePageSaidTheAnswerWasWrongDidNotSayHowToReproduceIt");
        }
    }
}

// A replay driven in a page, which says how that one run went rather than what it covered.
export async function aReplayDrivenInAPage(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    for (const root of ["/replay-ran", "/replay-scenario-failed", "/replay-invariant-failed", "/replay-broke"]) {
        const said = (await drivenInAPage(root, { replay: { seed: 1 } })).join("\n");
        if (!said.includes("replay") && !said.includes("would not run")) {
            throw new Error("AReplayDrivenInAPageDidNotSayHowItWent");
        }
    }
}
