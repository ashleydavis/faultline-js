// Scenarios for serving the work directory to a page.
//
// What a path is answered with turns on what is in the work directory, which is the run's own tree
// rather than a made up value. Starting the browser itself is not here: it needs a browser.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import type { RunModel } from "../model.ts";
import { driveInBrowser, emitDriver, serveOne } from "./browser.ts";
import { askedFromPage } from "./protocol.ts";

// Every answer one path can get.
export function everyAnswerAPathGets(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const work = "/served";
    fs.writeFileSync(`${work}/held.mjs`, "export const a = 1;\n");
    fs.writeFileSync(`${work}/held.css`, "body { color: red }\n");
    fs.writeFileSync(`${work}/held.map`, "{}\n");
    fs.writeFileSync(`${work}/held.png`, "not really a picture");

    // The page itself.
    const page = serveOne(work, "/");
    if (page.status !== 200 || page.type !== "text/html") {
        throw new Error("ThePageItselfWasNotServed");
    }
    if (serveOne(work, undefined).status !== 200) {
        throw new Error("ARequestNamingNoPathWasNotGivenThePage");
    }

    // A file of each kind, which is served as what that kind is.
    for (const [name, type] of [["held.mjs", "text/javascript"], ["held.css", "text/css"], ["held.map", "application/json"]]) {
        const held = serveOne(work, `/${name!}`);
        if (held.status !== 200) {
            throw new Error(`TheFile_${name!}_WasNotServed`);
        }
        if (held.type !== type) {
            throw new Error(`TheFile_${name!}_WasServedAs_${String(held.type)}`);
        }
    }
    // A kind the server has no name for is served as bytes.
    if (serveOne(work, "/held.png").type !== "application/octet-stream") {
        throw new Error("AKindWithNoNameWasNotServedAsBytes");
    }
    // A query is taken off before the path is read, and a name written with an escape is read back.
    if (serveOne(work, "/held.mjs?v=2").status !== 200) {
        throw new Error("APathWithAQueryOnItWasNotServed");
    }
    fs.writeFileSync(`${work}/a name.mjs`, "export const a = 1;\n");
    if (serveOne(work, "/a%20name.mjs").status !== 200) {
        throw new Error("APathWrittenWithAnEscapeWasNotReadBack");
    }

    // A path that climbs out of the work directory is refused.
    if (serveOne(work, "/../../etc/passwd").status !== 403) {
        throw new Error("APathClimbingOutOfTheWorkDirectoryWasServed");
    }

    // A path that is not there at all. The run's own tree answers every read, so a read the
    // injector fails is what a file that is not there looks like from here.
    injector.fail("files", "missing");
    if (serveOne(work, "/never-written.mjs").status !== 404) {
        throw new Error("APathThatCannotBeReadWasServed");
    }
}

// The driver a page loads, written out as modules a browser can load.
export function theDriverAPageLoads(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    // The driver sits beside the module that writes it out, and a copy of the tool has none beside
    // it, so one is written there. It imports another file twice, so the writing follows an import
    // and knows a file it has already written.
    const beside = (name: string): string => fileURLToPath(new URL(`./${name}`, import.meta.url));
    fs.writeFileSync(
        beside("page.ts"),
        ['import { one } from "./held.ts";', 'import { two } from "./held.ts";', "export const driven = one + two;", ""].join("\n"),
    );
    fs.writeFileSync(beside("held.ts"), "export const one = 1;\nexport const two = 2;\n");

    emitDriver("/emitted", { target: ts.ScriptTarget.ES2022 });
    if (!fs.existsSync("/emitted")) {
        throw new Error("TheDriverWasNotWrittenIntoTheWorkDirectory");
    }
}

// A copy of the tool with no driver beside it, which says what to do about it.
export function aCopyWithNoDriverBesideIt(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    // Both the TypeScript and the built JavaScript are taken away, because a copy of the tool is
    // looked in for either and what a run before this one left there is not this run's to rely on.
    for (const name of ["page.ts", "page.js"]) {
        const where = fileURLToPath(new URL(`./${name}`, import.meta.url));
        if (fs.existsSync(where)) {
            fs.rmSync(where);
        }
    }
    let said = "";
    try {
        emitDriver("/none", { target: ts.ScriptTarget.ES2022 });
    }
    catch (thrown) {
        said = (thrown as Error).message;
    }
    if (!said.includes("not found")) {
        throw new Error("ACopyWithNoPageDriverBesideItDidNotSaySo");
    }
}

// Driving a real page, from writing the driver out to reading what the page counted.
//
// Every request the page makes is answered inside this process, so a run measuring this file drives
// a page without a socket being opened. The driver the page loads is written by this scenario
// rather than being the tool's own: what is under test here is the driving, not what the page does
// once it is driving.
export async function drivingARealPage(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const beside = (name: string): string => fileURLToPath(new URL(`./${name}`, import.meta.url));
    fs.writeFileSync(
        beside("page.ts"),
        [
            "export async function driveInPage(model, units, ticked) {",
            "    void model; void units; void ticked;",
            // The page loads a copy, so what the page counted has a copy in it to be counted
            // against, and asks what has run, which is what the run answers from outside the page.
            '    const held = await import("/held.mjs");',
            "    held.greet(\"a\");",
            `    await window[${JSON.stringify(askedFromPage)}]("held.ts");`,
            // And about a file the run has none of, which is what a page asking about its own sim
            // file does.
            `    await window[${JSON.stringify(askedFromPage)}]("not-there.ts");`,
            '    return [{ type: "unit", index: 0, calls: 1, stepped: 0 }];',
            "}",
            "",
        ].join("\n"),
    );

    const work = "/driven-page";
    emitDriver(work, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
    fs.writeFileSync(`${work}/model.json`, "{}");
    // The copy the page loads carries a map back to the source it was rewritten from, the way a
    // copy a run made does. Without one, what V8 counted in the page is counted against no place in
    // anybody's source and the run has no way to say which path ran.
    const source = "export function greet(name) {\n    return name.length;\n}\n";
    fs.writeFileSync(
        `${work}/held.mjs`,
        ts.transpileModule(source, {
            fileName: "held.ts",
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, inlineSourceMap: true, inlineSources: true },
        }).outputText,
    );

    const model = {
        root: "/project",
        work,
        files: [
            {
                file: "held.ts",
                module: `${work}/held.mjs`,
                functions: [],
                classes: [],
                paths: [{ name: "greet:entered", describe: "the body of greet", file: "held.ts", line: 2, fn: "greet", at: { line: 2, column: 4 } }],
                tests: [],
                properties: [],
            },
        ],
        factories: [],
        scenarios: [],
        invariants: [],
        simModules: {},
        unseen: [],
        seeds: [1],
        callBudget: 200,
    } as unknown as RunModel;

    // The machine's own browser is named where there is one, and a run with none named falls back
    // to whatever Playwright installed.
    const named = process.env.FAULTLINE_CHROMIUM;
    delete process.env.FAULTLINE_CHROMIUM;
    let done;
    try {
        done = await driveInBrowser(model, [], [], named);
        // And again with no browser named at all, which is the ordinary way it is run.
        await driveInBrowser(model, [], [], undefined);
    }
    finally {
        if (named !== undefined) {
            process.env.FAULTLINE_CHROMIUM = named;
        }
    }
    if (done.broke !== undefined) {
        // A machine with no browser on it says so, and that is the answer rather than a failure.
        // A machine with no browser on it says so, and that is the answer rather than a failure.
        if (!done.broke.includes("Playwright") && !done.broke.includes("would not start")) {
            throw new Error("TheDrivingStoppedForSomethingOtherThanAMissingBrowser");
        }
        return;
    }
    if (done.said.length !== 1) {
        throw new Error("TheDrivingDidNotBringBackWhatThePageSaid");
    }
}

// Driving on a machine with no package to drive a browser through, which says what to install.
export async function drivingWithNoPackageToDriveThrough(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const model = { root: "/project", work: "/no-package", files: [], factories: [], scenarios: [], invariants: [], simModules: {}, unseen: [], seeds: [1], callBudget: 200 } as unknown as RunModel;
    const done = await driveInBrowser(model, [], [], undefined, "a-package-no-machine-has");
    if (done.broke === undefined || !done.broke.includes("install")) {
        throw new Error("ARunWithNoPackageToDriveABrowserThroughDidNotSayWhatToInstall");
    }
}

// Driving with a browser that will not start, which is what a machine with none installed does.
export async function drivingWithNoBrowserToDriveIn(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const model = { root: "/project", work: "/no-browser", files: [], factories: [], scenarios: [], invariants: [], simModules: {}, unseen: [], seeds: [1], callBudget: 200 } as unknown as RunModel;
    const done = await driveInBrowser(model, [], [], "/there-is-no-browser-here");
    if (done.broke === undefined) {
        throw new Error("DrivingWithNoBrowserToDriveInDidNotSaySo");
    }
}
