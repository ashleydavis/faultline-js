//
// Checks the child: opening a source file and a sim file, calling every kind of function the way
// discovery says it is reached, loading copies of the project's modules of its own for every call,
// judging what each call did, running the expectation functions after every call and scenario,
// writing down the values each call was made with and answering the worker's requests in order.
//
// The project is a file system in memory. The child is wired to this process: project files are
// run with `vm` under the URLs the child imports them by. A relative import inside one is numbered
// from the importer's URL, the way the module hooks number it. Every URL imported is written down.
// Coverage is V8's own precise coverage in this process, read after every call. The event loop is a
// stand-in whose clock moves on a fixed step each turn, so a call that never settles is judged
// without any real waiting. The globals are replaced, so the code under test reaches the simulated
// world.
//

import assert from "node:assert/strict";
import { Session } from "node:inspector/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { afterAll, beforeAll, describe, test } from "@jest/globals";
import ts from "typescript";
import { startCoverage, takeCoverage } from "../coverage/v8.ts";
import type { FunctionInfo } from "../discover/functions.ts";
import { createFakeProject, projectRoot, simTypesFile, testConfig } from "../lib/fake-files.test.ts";
import type { IFileSystem } from "../lib/file-system.ts";
import { copyNumberOf, createLoader, loadedText, numberedUrl, type ILoader } from "../load/hooks.ts";
import { createValueContext, type IValueContext } from "../values/build.ts";
import type { IChoice } from "../values/choices.ts";
import { createFactoryTable } from "../values/factories.ts";
import { runWith } from "../world/current.ts";
import { installGlobals, removeGlobals } from "../world/globals.ts";
import { ProcessExitCalled, RunSubject } from "../world/subject.ts";
import type { IEventLoop } from "./call.ts";
import { answerRequest, buildCallValues, buildReceiver, callContext, callExported, createChild, ValuesNotBuilt, describeValues, emptyFacts, fileUrl, importCopy, importFresh, isChildSettings, isOpenRequest, isStop, loadCopies, openShard, parseProblem, readSourceText, receiverChoices, receiverKey, requestsWaitingMost, serveChild, startCopies, unbuildableType, useMember, type IChild, type IChildHost, type IChildState, type IMessageSource } from "./child.ts";
import { ExpectationStop } from "./contexts.ts";
import { pathKey, withoutQuery } from "./measure.ts";
import { LocalShardReader } from "./shard-reader.ts";
import type { ICallResult, IChildSettings, IOpenRequest, IReply, IShardFacts } from "./messages.ts";

//
// The project's files, by their path from its root.
//
const projectFiles: Record<string, string> = {
    "package.json": "{ \"name\": \"project\", \"type\": \"commonjs\" }\n",
    "tsconfig.json": testConfig.replace("\"noLib\": true,", "\"noLib\": true, \"strict\": true, \"allowImportingTsExtensions\": true, \"noEmit\": true,"),
    "src/calc.ts": [
        "export function divide(dividend: number, divisor: number): number {",
        "    if (divisor === 0) {",
        "        return Number.NaN;",
        "    }",
        "    return dividend / divisor;",
        "}",
        "export function boom(items: number[]): number {",
        "    const found = items as unknown as { value: number }[];",
        "    return found[0]!.value;",
        "}",
        "export function never(): Promise<void> {",
        "    return new Promise(() => undefined);",
        "}",
        "export function exits(code: number): void {",
        "    if (code === 1) {",
        "        process.exit(3);",
        "    }",
        "}",
        "export function late(): void {",
        "    setTimeout(() => {",
        "        throw new Error(\"late\");",
        "    }, 10);",
        "}",
        "export class Counter {",
        "    private count = 0;",
        "    constructor(start: number) {",
        "        this.count = start;",
        "    }",
        "    add(step: number): number {",
        "        this.count += step;",
        "        return this.count;",
        "    }",
        "    get value(): number {",
        "        return this.count;",
        "    }",
        "    set value(next: number) {",
        "        this.count = next;",
        "    }",
        "    static make(): Counter {",
        "        return new Counter(1);",
        "    }",
        "}",
        "export const holder = {",
        "    twice(value: number): number {",
        "        return value * 2;",
        "    },",
        "};",
        "function hidden(flag: boolean): string {",
        "    return flag ? \"yes\" : \"no\";",
        "}",
        "export function home(): string {",
        "    return process.env.HOME ?? \"none\";",
        "}",
        "export function outer(): number {",
        "    function inner(): number {",
        "        return 1;",
        "    }",
        "    return inner();",
        "}",
        "export function exitsLater(): void {",
        "    setTimeout(() => {",
        "        process.exit(4);",
        "    }, 5);",
        "}",
        "",
    ].join("\n"),
    "src/calc.sim.ts": [
        "import type { ExpectationContext, ScenarioContext } from \"faultline\";",
        "import { divide } from \"./calc.ts\";",
        "export function divideWorks(context: ScenarioContext): void {",
        "    context.expect(divide(6, 3) === 2, \"six over three to be two\");",
        "    context.expect(divide(1, 1) === 2, \"one over one to be two\");",
        "}",
        "export async function loads(context: ScenarioContext): Promise<void> {",
        "    const loaded = await context.load(\"src/calc.ts\");",
        "    context.expect(typeof loaded.divide === \"function\", \"divide to be loaded\");",
        "}",
        "export function crashes(context: ScenarioContext): void {",
        "    const empty: { value: number }[] = [];",
        "    context.expect(empty[0]!.value === 1, \"the first to be one\");",
        "}",
        "export function never(context: ScenarioContext): Promise<void> {",
        "    context.expect(true, \"fine\");",
        "    return new Promise(() => undefined);",
        "}",
        "export function neverHolds(context: ExpectationContext): void {",
        "    context.expect(false, \"never to hold\");",
        "}",
        "export function stillWaits(context: ExpectationContext): Promise<void> {",
        "    context.expect(true, \"fine\");",
        "    return new Promise(() => undefined);",
        "}",
        "export function breaks(context: ExpectationContext): void {",
        "    const empty: { value: number }[] = [];",
        "    context.expect(empty[0]!.value === 1, \"the first to be one\");",
        "}",
        "export function throwsItsOwn(context: ExpectationContext): void {",
        "    context.expect(true, \"fine\");",
        "    throw new Error(\"its own\");",
        "}",
        "export function holds(context: ExpectationContext): void {",
        "    context.expect(true, \"fine\");",
        "}",
        "",
    ].join("\n"),
    "src/plain.ts": "export function one(): number {\n    return 1;\n}\n",
    "src/watched.ts": "export function cheap(): number {\n    return 1;\n}\nexport function checked(flag: boolean): number {\n    if (flag) {\n        return 1;\n    }\n    return 2;\n}\n",
    "src/watched.sim.ts": "import type { ExpectationContext } from \"faultline\";\nimport { checked } from \"./watched.ts\";\nexport function checksIt(context: ExpectationContext): void {\n    context.expect(checked(true) === 1, \"checked to give one\");\n}\n",
    "src/plain.sim.ts": "export const nothing = 1;\nfunction quiet(): void {\n}\n",
    "src/broken.ts": "throw new Error(\"no config\");\nexport function unreachable(): number {\n    return 1;\n}\n",
    "src/broken.sim.ts": "export const wrong: number = \"text\";\nthrow new Error(\"no sim\");\n",
    "src/unparsed.ts": "export function broken( {\n",
    "src/flaky.ts": [
        "loads.count += 1;",
        "if (loads.count > 1) {",
        "    const nothing = undefined as unknown as { value: number };",
        "    nothing.value = 1;",
        "}",
        "export function steady(): number {",
        "    return 1;",
        "}",
        "",
    ].join("\n"),
    "src/boxes.ts": [
        "export interface Box {",
        "    count: number;",
        "}",
        "export function size(box: Box): number {",
        "    return box.count;",
        "}",
        "",
    ].join("\n"),
    "src/ends.ts": "process.exit(2);\nexport function later(): number {\n    return 1;\n}\n",
    "src/tally.ts": [
        "export class Tally {",
        "    private start: number;",
        "    constructor(start: number) {",
        "        this.start = start;",
        "    }",
        "    size(): string {",
        "        if (this.start > 5) {",
        "            return \"big\";",
        "        }",
        "        return \"small\";",
        "    }",
        "    plus(step: number): number {",
        "        return this.start + step;",
        "    }",
        "}",
        "",
    ].join("\n"),
    "src/tally.sim.ts": [
        "import { Tally } from \"./tally.ts\";",
        "export function bigTally(): Tally {",
        "    return new Tally(9);",
        "}",
        "export function smallTally(): Tally {",
        "    return new Tally(1);",
        "}",
        "",
    ].join("\n"),
    "src/fragile.ts": [
        "export interface Shelf {",
        "    count: number;",
        "}",
        "export function count(shelf: Shelf): number {",
        "    return shelf.count;",
        "}",
        "export class Rack {",
        "    size(): number {",
        "        return 1;",
        "    }",
        "}",
        "",
    ].join("\n"),
    "src/fragile.sim.ts": [
        "import type { Shelf } from \"./fragile.ts\";",
        "import { Rack } from \"./fragile.ts\";",
        "export function brokenShelf(): Shelf {",
        "    throw new Error(\"no shelf to build\");",
        "}",
        "export function brokenRack(): Rack {",
        "    throw new Error(\"no rack to build\");",
        "}",
        "",
    ].join("\n"),
    "src/boxes.sim.ts": [
        "import type { Box } from \"./boxes.ts\";",
        "export class Boxes {",
        "    private at = 0;",
        "    next(): Box {",
        "        this.at += 1;",
        "        return { count: this.at };",
        "    }",
        "}",
        "",
    ].join("\n"),
};

//
// The coverage session the child reads, connected before the tests and disconnected after them.
//
const session = new Session();

beforeAll(async () => {
    installGlobals();
    session.connect();
    await startCoverage(session);
});

afterAll(() => {
    session.disconnect();
    removeGlobals();
    runWith(undefined);
});

//
// How far the stand-in event loop's clock moves each turn, in milliseconds. It is a small part of
// the hosts' wall-clock limit, so a call that waits on real work is given several turns and is
// still judged within a moment.
//
const turnStepMs = 10;

//
// An event loop whose clock moves on `turnStepMs` each turn, whose turns let what waits on the
// event loop run and which holds no real work open.
//
export class FakeEventLoop implements IEventLoop {
    //
    // The turns given so far.
    //
    turns = 0;

    //
    // The clock, which moves only when a turn is given, so no test waits on the wall clock.
    //
    nowMs(): number {
        return this.turns * turnStepMs;
    }

    //
    // One turn through `setImmediate`, so the promises and callbacks the code under test left
    // waiting run before the child looks at the call again.
    //
    async nextTurn(): Promise<void> {
        this.turns += 1;
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
    }

    //
    // No real work is ever open, so a call that waits on no timer is known never to settle.
    //
    openCount(): number {
        return 0;
    }
}

//
// How many times `src/flaky.ts` has been loaded, which its top level reads.
//
export interface ILoadCount {
    //
    // The loads so far.
    //
    count: number;
}

//
// The modules a test host has run, by the URL each was imported under, with what running one needs.
//
export interface IVmModules {
    //
    // The loader that transpiles each project file the way the module hooks do.
    //
    loader: ILoader;

    //
    // What each URL's module exports.
    //
    modules: Map<string, Record<string, unknown>>;

    //
    // How many times `src/flaky.ts` has been loaded.
    //
    loads: ILoadCount;
}

//
// A host over a project in memory, with what the tests read back from it.
//
export interface ITestHost extends IChildHost {
    //
    // Every URL the child imported, in order.
    //
    imported: string[];

    //
    // How many times `src/flaky.ts` has been loaded.
    //
    loads: ILoadCount;
}

//
// One module `runOrder` has still to place, with whether the modules it imports are placed already.
//
export interface IVmStep {
    //
    // The URL of the module.
    //
    url: string;

    //
    // Whether the modules it imports have been put on the list ahead of it.
    //
    isExpanded: boolean;
}

//
// The most steps `runOrder` takes for one import. Each module takes two steps and each import one
// more. The project in memory has a handful of each, so more steps than this is a defect in the
// stand-in rather than a project it has to load.
//
export const runStepsMost = 1000;

//
// The URL a relative import written in the module at `importerUrl` leads to: the file it names,
// numbered with the importer's copy number, the way the module hooks number it.
//
export function importedUrl(importerUrl: string, specifier: string): string {
    assert(specifier.startsWith("."), `The project in memory imports ${specifier}, which is not a relative path.`);
    const importer = fileURLToPath(withoutQuery(importerUrl));
    return numberedUrl(path.resolve(path.dirname(importer), specifier), copyNumberOf(importerUrl));
}

//
// The URLs the module at `url` imports, read from what the loader transpiled it to.
//
export async function importedUrls(held: IVmModules, url: string): Promise<string[]> {
    const text = await loadedText(held.loader, fileURLToPath(withoutQuery(url)));
    const imports = ts.preProcessFile(text, true, true).importedFiles;
    return imports.map((imported) => importedUrl(url, imported.fileName));
}

//
// The URLs an import of `url` runs, each after the modules it imports, leaving out every module
// that has run already. Node runs a module's imports before the module. The list does the same
// with a bounded loop instead of an import that runs inside another.
//
export async function runOrder(held: IVmModules, url: string): Promise<string[]> {
    const order: string[] = [];
    const listed = new Set<string>();
    const steps: IVmStep[] = [
        {
            url,
            isExpanded: false,
        },
    ];
    for (let turn = 0; turn < runStepsMost; turn += 1) {
        const step = steps.pop();
        if (step === undefined) {
            return order;
        }
        if (step.isExpanded) {
            order.push(step.url);
            continue;
        }
        if (held.modules.has(step.url)) {
            continue;
        }
        if (listed.has(step.url)) {
            continue;
        }
        listed.add(step.url);
        steps.push({
            url: step.url,
            isExpanded: true,
        });
        for (const imported of await importedUrls(held, step.url)) {
            steps.push({
                url: imported,
                isExpanded: false,
            });
        }
    }
    assert.fail(`Importing ${url} took more than ${runStepsMost} steps.`);
}

//
// Runs the module at `url` once with `vm`, the way Node keeps one module per URL. Every module it
// imports has run already, so its `require` only looks the module up.
//
export function runInVm(held: IVmModules, url: string): void {
    assert(!held.modules.has(url), `${url} has run already.`);
    const text = held.loader.transpiled.get(fileURLToPath(withoutQuery(url)));
    assert(text !== undefined, `${url} was not transpiled before it ran.`);
    const exports: Record<string, unknown> = {};
    held.modules.set(url, exports);
    vm.runInNewContext(text, {
        exports,
        require: (specifier: string) => ranModule(held, importedUrl(url, specifier)),
        process,
        setTimeout: globalThis.setTimeout,
        loads: held.loads,
    }, {
        filename: url,
    });
}

//
// What the module at `url` exports, which has run already.
//
export function ranModule(held: IVmModules, url: string): Record<string, unknown> {
    const exports = held.modules.get(url);
    assert(exports !== undefined, `${url} was imported before it ran.`);
    return exports;
}

//
// The module a URL names: every module it leads to that has not run is run with `vm`, in the
// order `runOrder` gives.
//
export async function loadInVm(held: IVmModules, url: string): Promise<Record<string, unknown>> {
    for (const ready of await runOrder(held, url)) {
        runInVm(held, ready);
    }
    return ranModule(held, url);
}

//
// A host that runs the project's files in this process with `loadInVm` and writes down every URL
// the child imports.
//
export function createTestHost(): ITestHost {
    const files = createFakeProject(projectFiles);
    const loader = createLoader({
        projectRoot,
        toolModules: path.resolve(__dirname, ".."),
    }, files);
    const held: IVmModules = {
        loader,
        modules: new Map(),
        loads: {
            count: 0,
        },
    };
    const imported: string[] = [];
    return {
        settings: {
            projectRoot,
            toolModules: path.resolve(__dirname, ".."),
            simTypes: [simTypesFile],
            limits: {
                wallMs: 200,
                afterSettleMs: 60000,
            },
        },
        loader,
        reader: new LocalShardReader(loader, [simTypesFile]),
        importFile: (url: string) => {
            imported.push(url);
            return loadInVm(held, url);
        },
        takeCoverage: () => takeCoverage(session),
        eventLoop: new FakeEventLoop(),
        watch: {
            uncaught: [],
        },
        imported,
        loads: held.loads,
    };
}

//
// The state of a child wired to `host`, built the way `createChild` builds it, so a test can open a
// shard and call the parts on it.
//
export function createTestState(host: IChildHost): IChildState {
    return {
        host,
        judge: {
            projectRoot: host.settings.projectRoot,
            readSource: (file: string) => readSourceText(host.loader.reading.fileSystem, file),
        },
        shard: undefined,
        numbersGiven: 0,
        copyNumber: 0,
    };
}

//
// The URLs of `file` among `imported`.
//
export function fileUrls(imported: string[], file: string): string[] {
    const unnumbered = pathToFileURL(path.join(projectRoot, file)).href;
    return imported.filter((url) => withoutQuery(url) === unnumbered);
}

//
// A request to open `file` with the sim files `sims`, under seed 7.
//
export function openRequest(file: string, sims: string[]): IOpenRequest {
    return {
        kind: "open",
        file,
        sims,
        seed: 7,
    };
}

//
// The kinds and messages of a call's failures.
//
export function failureLines(result: ICallResult): string[] {
    return result.failures.map((failure) => `${failure.kind}: ${failure.message}`);
}

describe("opening a source file", () => {
    test("every function is listed with how it is called, its choices and the paths it waits for", async () => {
        const child = createChild(createTestHost());
        const facts = await child.open(openRequest("src/calc.ts", ["src/calc.sim.ts"]));
        assert.deepEqual(facts.functions.map((plan) => plan.name), [
            "(top level)",
            "divide",
            "boom",
            "never",
            "exits",
            "late",
            "Counter.constructor",
            "Counter.add",
            "Counter.value",
            "Counter.value@36",
            "Counter.make",
            "holder.twice",
            "hidden",
            "home",
            "outer",
            "inner",
            "exitsLater",
        ]);
        const byName = new Map(facts.functions.map((plan) => [plan.name, plan]));
        assert.equal(byName.get("divide")!.choices.length, 2);
        assert.equal(byName.get("divide")!.choices[0]![0]!.source, "boundary");
        assert.equal(byName.get("inner")!.uncallable, "it is written inside another function, so only that function reaches it");
        assert.deepEqual(byName.get("inner")!.choices, []);
        assert.deepEqual(byName.get("outer")!.targets, [pathKey("src/calc.ts", "outer:entered"), pathKey("src/calc.ts", "inner:entered")]);
        assert.deepEqual(byName.get("divide")!.targets, [pathKey("src/calc.ts", "divide:entered"), pathKey("src/calc.ts", "if:2:true"), pathKey("src/calc.ts", "if:2:false")]);
        assert.equal(facts.paths.find((record) => record.key === pathKey("src/calc.ts", "if:2:true"))?.line, 2);
        assert.deepEqual(facts.uncallable.map((uncallable) => uncallable.label), ["inner"]);
        assert.deepEqual(facts.scenarios, []);
        assert.deepEqual(facts.simProblems, []);
        assert.equal(facts.loadProblem, undefined);
    });

    test("a file whose top level ends the process has no load problem, and the rest of it waits for a scenario", async () => {
        const child = createChild(createTestHost());
        const facts = await child.open(openRequest("src/ends.ts", []));
        assert.equal(facts.loadProblem, undefined);
        assert.deepEqual(facts.functions.map((plan) => [plan.name, plan.uncallable]), [
            ["(top level)", undefined],
            ["later", "its file ends the process when it is loaded, so only a scenario that loads it with what it needs reaches it"],
        ]);
        const top = await child.call("src/ends.ts:(top level);seed=7", true);
        assert.deepEqual(top.failures, []);
    });

    test("a file that fails to load leaves only its top level callable and a broken sim file is reported", async () => {
        const child = createChild(createTestHost());
        const facts = await child.open(openRequest("src/broken.ts", ["src/broken.sim.ts"]));
        assert.equal(facts.loadProblem, "src/broken.ts failed to load, so only its top level is called: Error: no config.");
        assert.deepEqual(facts.functions.map((plan) => [plan.name, plan.uncallable]), [
            ["(top level)", undefined],
            ["unreachable", "its file failed to load"],
        ]);
        assert.equal(facts.simProblems.length, 2);
        assert.match(facts.simProblems[0]!, /^The sim file src\/broken\.sim\.ts has an error: .*Type 'string' is not assignable to type 'number'/);
        assert.equal(facts.simProblems[1], "The sim file src/broken.sim.ts failed to load: Error: no sim.");
        const top = await child.call("src/broken.ts:(top level);seed=7", true);
        assert.deepEqual(top.failures, []);
    });

    test("a file that does not parse is not loaded and has no functions or code paths, and says where it does not parse", async () => {
        const host = createTestHost();
        const child = createChild(host);
        const facts = await child.open(openRequest("src/unparsed.ts", []));
        assert.match(facts.loadProblem ?? "", /^src\/unparsed\.ts does not parse, so it was not loaded: src\/unparsed\.ts:2:1: /);
        assert.deepEqual(facts.functions, []);
        assert.deepEqual(facts.paths, []);
        assert(!host.imported.some((url) => url.includes("unparsed")));
    });
});

describe("parseProblem", () => {
    test("a file with parse errors gets one problem line naming every place, and a file that parses gets none", () => {
        assert.equal(parseProblem("src/a.ts", []), undefined);
        assert.equal(parseProblem("src/a.ts", ["src/a.ts:1:1: '}' expected.", "src/a.ts:2:1: ')' expected."]), "src/a.ts does not parse, so it was not loaded: src/a.ts:1:1: '}' expected. src/a.ts:2:1: ')' expected.");
    });
});

describe("calling", () => {
    test("every kind of function is called the way discovery says it is reached", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/calc.ts", []));
        const exercised = async (token: string): Promise<string[]> => (await child.call(token, true)).exercised.map((key) => key.split("\t")[1]!);
        assert.deepEqual(await exercised("src/calc.ts:(top level);seed=7"), ["(top level):entered"]);
        //
        // A call loads its own copy of the file first, which runs its top level, and what loading
        // ran counts in the call's reading.
        //
        assert.deepEqual(await exercised("src/calc.ts:divide;seed=7;values=b1,b0"), ["(top level):entered", "divide:entered", "if:2:true"]);
        assert.deepEqual(await exercised("src/calc.ts:Counter.constructor;seed=7;values=b0"), ["(top level):entered", "Counter.constructor:entered"]);
        assert.deepEqual(await exercised("src/calc.ts:Counter.add;seed=7;values=b0"), ["(top level):entered", "Counter.add:entered", "Counter.constructor:entered"]);
        assert.deepEqual(await exercised("src/calc.ts:Counter.value;seed=7"), ["(top level):entered", "Counter.constructor:entered", "Counter.value:entered"]);
        assert.deepEqual(await exercised("src/calc.ts:Counter.value@36;seed=7;values=b0"), ["(top level):entered", "Counter.constructor:entered", "Counter.value:entered#2"]);
        assert.deepEqual(await exercised("src/calc.ts:Counter.make;seed=7"), ["(top level):entered", "Counter.constructor:entered", "Counter.make:entered"]);
        assert.deepEqual(await exercised("src/calc.ts:holder.twice;seed=7;values=b0"), ["(top level):entered", "holder.twice:entered"]);
        assert.deepEqual(await exercised("src/calc.ts:hidden;seed=7;values=b1"), ["(top level):entered", "hidden:entered", "ternary:49:true"]);
        assert.deepEqual(await exercised("src/calc.ts:outer;seed=7"), ["(top level):entered", "inner:entered", "outer:entered"]);
    });

    test("a crash, a call that never settles and an error no code caught are each judged, and a call of process.exit is no failure", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/calc.ts", []));
        assert.deepEqual(failureLines(await child.call("src/calc.ts:boom;seed=7;values=b0", true)), [
            "crash: The call to boom crashed with TypeError: Cannot read properties of undefined (reading 'value').",
        ]);
        assert.deepEqual(failureLines(await child.call("src/calc.ts:never;seed=7", true)), ["hang: The call to never never returned."]);
        const exited = await child.call("src/calc.ts:exits;seed=7;values=b1", true);
        assert.deepEqual(failureLines(exited), []);
        assert.deepEqual(exited.exercised.map((key) => key.split("\t")[1]), ["(top level):entered", "exits:entered", "if:15:true"]);
        assert.deepEqual(failureLines(await child.call("src/calc.ts:late;seed=7", true)), ["uncaught: The call to late left an error that no code caught: Error: late."]);
        const exitedLater = await child.call("src/calc.ts:exitsLater;seed=7", true);
        assert.deepEqual(failureLines(exitedLater), []);
        const fine = await child.call("src/calc.ts:divide;seed=7;values=b1,b1", true);
        assert.deepEqual(fine.failures, []);
        assert.equal(fine.injected, false);
        assert.deepEqual(fine.arguments, ["1", "1"]);
        assert.deepEqual((await child.call("src/calc.ts:never;seed=7", true)).arguments, []);
    });

    test("the places a call reaches come back with it and a planned failure says whether it was injected", async () => {
        const host = createTestHost();
        const child = createChild(host);
        await child.open(openRequest("src/calc.ts", []));
        const uninjected = await child.call("src/calc.ts:home;seed=7", true);
        assert.deepEqual(uninjected.reached, [{
            place: {
                effect: "environment",
                occurrence: 0,
            },
            failures: ["variable-not-set", "variable-set-to-an-empty-value"],
        }]);
        assert.equal(uninjected.injected, false);
        const injected = await child.call("src/calc.ts:home;seed=7;fail=environment#0/variable-set-to-an-empty-value", true);
        assert.equal(injected.injected, true);
        const missed = await child.call("src/calc.ts:late;seed=7;fail=clock#0/time-stands-still", true);
        assert.deepEqual(missed.reached, []);
        assert.equal(missed.injected, false);
    });

    test("the expectation functions of the shard's sim files run after every call and are judged", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/calc.ts", ["src/calc.sim.ts"]));
        assert.deepEqual(failureLines(await child.call("src/calc.ts:divide;seed=7;values=b1,b1", true)), [
            "expectation: The expectation \"never to hold\" in neverHolds did not hold.",
            "hang: The expectation function stillWaits never returned.",
            "crash: The expectation function breaks crashed with TypeError: Cannot read properties of undefined (reading 'value').",
        ]);
    });
});

describe("the instance a method is called on", () => {
    test("a method is planned and called on each instance the value factories returning its class give, before its own values", async () => {
        const child = createChild(createTestHost());
        const facts = await child.open(openRequest("src/tally.ts", ["src/tally.sim.ts"]));
        const size = facts.functions.find((plan) => plan.label === "Tally.size");
        const plus = facts.functions.find((plan) => plan.label === "Tally.plus");
        assert.deepEqual(size?.choices, [[{ source: "factory", index: 0 }, { source: "factory", index: 1 }]]);
        assert.equal(plus?.choices.length, 2);
        assert.deepEqual(plus?.choices[0], [{ source: "factory", index: 0 }, { source: "factory", index: 1 }]);
        const exercised = async (token: string): Promise<string[]> => (await child.call(token, true)).exercised.map((key) => key.split("\t")[1]!);
        assert.ok((await exercised("src/tally.ts:Tally.size;seed=7;values=f0")).includes("if:7:true"));
        assert.ok((await exercised("src/tally.ts:Tally.size;seed=7;values=f1")).includes("if:7:false"));
        const added = await child.call("src/tally.ts:Tally.plus;seed=7;values=f1,b1", true);
        assert.deepEqual(added.failures, []);
        assert.deepEqual(added.arguments, ["1"]);
    });

    test("with no factory returning its class, a method is called on an instance built from the constructor's first values", async () => {
        const child = createChild(createTestHost());
        const facts = await child.open(openRequest("src/tally.ts", []));
        const size = facts.functions.find((plan) => plan.label === "Tally.size");
        assert.deepEqual(size?.choices, []);
        assert.ok((await child.call("src/tally.ts:Tally.size;seed=7", true)).exercised.some((key) => key.endsWith("if:7:false")));
    });
});

describe("receiverKey", () => {
    test("only an instance method has the key of its class", async () => {
        const state = createTestState(createTestHost());
        await openShard(state, openRequest("src/calc.ts", []));
        const shard = state.shard;
        assert.ok(shard !== undefined);
        assert.equal(receiverKey(shard, shard.functions.get("Counter.add")!), "src/calc.ts#Counter");
        assert.equal(receiverKey(shard, shard.functions.get("Counter.make")!), undefined);
        assert.equal(receiverKey(shard, shard.functions.get("divide")!), undefined);
    });
});

describe("receiverChoices", () => {
    test("a function that is no instance method, or a class no factory returns, has no instance to choose", async () => {
        const state = createTestState(createTestHost());
        await openShard(state, openRequest("src/calc.ts", []));
        const shard = state.shard;
        assert.ok(shard !== undefined);
        const context = callContext(shard, await loadCopies(state, shard, new RunSubject(7, undefined), undefined), shard.functions.get("Counter.add")!);
        assert.deepEqual(receiverChoices(context, undefined), []);
        assert.deepEqual(receiverChoices(context, "src/calc.ts#Counter"), []);
    });
});

describe("coverage of the expectation functions", () => {
    test("what an expectation function runs counts for neither the call before it nor the next call", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/watched.ts", ["src/watched.sim.ts"]));
        const first = await child.call("src/watched.ts:cheap;seed=7", true);
        const second = await child.call("src/watched.ts:cheap;seed=7", true);
        assert.deepEqual(first.failures, []);
        assert.deepEqual(second.failures, []);
        for (const result of [first, second]) {
            assert(result.exercised.includes(pathKey("src/watched.ts", "cheap:entered")));
            assert(!result.exercised.includes(pathKey("src/watched.ts", "checked:entered")));
            assert(!result.exercised.includes(pathKey("src/watched.ts", "if:5:true")));
        }
    });
});

describe("coverage read later", () => {
    test("a call that does not read leaves its counts for the next reading, which holds every call since the last", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/calc.ts", []));
        const unread = await child.call("src/calc.ts:divide;seed=7;values=b1,b0", false);
        assert.deepEqual(unread.exercised, []);
        await child.call("src/calc.ts:outer;seed=7", false);
        const names = (await child.read()).map((key) => key.split("\t")[1]!);
        assert(names.includes("divide:entered"));
        assert(names.includes("outer:entered"));
        assert.deepEqual(await child.read(), []);
    });

    test("a shard with expectation functions is read after every call whatever the call asks", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/watched.ts", ["src/watched.sim.ts"]));
        const result = await child.call("src/watched.ts:cheap;seed=7", false);
        assert(result.exercised.includes(pathKey("src/watched.ts", "cheap:entered")));
    });

    test("a reading before any shard is opened is a defect in the worker", async () => {
        await assert.rejects(createChild(createTestHost()).read(), /before any shard was opened/);
    });
});

describe("scenarios", () => {
    test("a sim file's scenarios are listed and a false expectation is reported only with no failure injected", async () => {
        const child = createChild(createTestHost());
        const facts: IShardFacts = await child.open(openRequest("src/calc.sim.ts", ["src/calc.sim.ts"]));
        assert.deepEqual(facts.scenarios, [
            {
                name: "divideWorks",
                line: 3,
            },
            {
                name: "loads",
                line: 7,
            },
            {
                name: "crashes",
                line: 11,
            },
            {
                name: "never",
                line: 15,
            },
        ]);
        assert.deepEqual(facts.functions, []);
        const uninjected = await child.call("src/calc.sim.ts:divideWorks;seed=7", true);
        assert.equal(uninjected.failures[0]!.message, "The expectation \"one over one to be two\" in divideWorks did not hold.");
        assert.deepEqual(failureLines(uninjected).slice(1), [
            "expectation: The expectation \"never to hold\" in neverHolds did not hold.",
            "hang: The expectation function stillWaits never returned.",
            "crash: The expectation function breaks crashed with TypeError: Cannot read properties of undefined (reading 'value').",
        ]);

        //
        // Code run with `vm` here has no source map applied to its stack, so only the file is
        // checked. The line is checked in a real child process, which maps stacks to the source.
        //
        assert.match(uninjected.failures[0]!.location, /^src\/calc\.sim\.ts:\d+$/);
        assert.ok(uninjected.exercised.includes(pathKey("src/calc.ts", "if:2:false")));
        const injected = await child.call("src/calc.sim.ts:divideWorks;seed=7;fail=clock#0/time-stands-still", true);
        assert.equal(injected.failures.some((failure) => failure.message.includes("one over one")), false);
        const loaded = await child.call("src/calc.sim.ts:loads;seed=7", true);
        assert.ok(loaded.exercised.includes(pathKey("src/calc.ts", "(top level):entered")));
        assert.equal(loaded.failures.some((failure) => failure.message.includes("divide to be loaded")), false);
        assert.equal((await child.call("src/calc.sim.ts:crashes;seed=7", true)).failures[0]!.kind, "crash");
        assert.equal((await child.call("src/calc.sim.ts:never;seed=7", true)).failures[0]!.message, "The scenario never never returned.");
    });

    test("a sim file that fails to load offers no scenario", async () => {
        const child = createChild(createTestHost());
        const facts = await child.open(openRequest("src/broken.sim.ts", ["src/broken.sim.ts"]));
        assert.deepEqual(facts.scenarios, []);
        assert.equal(facts.simProblems.length, 2);
    });

    test("a sim file with nothing to run offers no scenario and runs no expectation", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/plain.ts", ["src/plain.sim.ts"]));
        assert.deepEqual((await child.call("src/plain.ts:one;seed=7", true)).failures, []);
    });
});

describe("copies of the project's modules", () => {
    test("every call imports the shard's file and its sim files under a number of its own", async () => {
        const host = createTestHost();
        const child = createChild(host);
        await child.open(openRequest("src/calc.ts", ["src/calc.sim.ts"]));
        await child.call("src/calc.ts:divide;seed=7;values=b1,b1", true);
        await child.call("src/calc.ts:divide;seed=7;values=b1,b1", true);
        const sources = fileUrls(host.imported, "src/calc.ts");
        const sims = fileUrls(host.imported, "src/calc.sim.ts");
        assert.equal(sources.length, 3);
        assert.equal(new Set(sources).size, 3);
        assert.deepEqual(sims.map((url) => url.slice(url.indexOf("?"))), sources.map((url) => url.slice(url.indexOf("?"))));
        assert.match(sources[2]!, /\?flt=\d+$/);
    });

    test("a module's state is never seen by the next call, because each call has a copy of its own", async () => {
        const host = createTestHost();
        const child = createChild(host);
        await child.open(openRequest("src/calc.ts", []));
        const first = await child.call("src/calc.ts:Counter.add;seed=7;values=b1", true);
        const second = await child.call("src/calc.ts:Counter.add;seed=7;values=b1", true);
        assert.deepEqual(second, first);
    });

    test("a call of the top level imports the file afresh under a number no copy has", async () => {
        const host = createTestHost();
        const child = createChild(host);
        await child.open(openRequest("src/calc.ts", ["src/calc.sim.ts"]));
        const before = host.imported.length;
        const top = await child.call("src/calc.ts:(top level);seed=7", true);
        assert.deepEqual(top.exercised, [pathKey("src/calc.ts", "(top level):entered")]);
        const made = host.imported.slice(before);
        assert.equal(fileUrls(made, "src/calc.sim.ts").length, 1);
        assert.equal(fileUrls(made, "src/calc.ts").length, 1);
        assert.notEqual(fileUrls(made, "src/calc.ts")[0]!.split("?")[1], fileUrls(made, "src/calc.sim.ts")[0]!.split("?")[1]);
    });

    test("a copy that fails to load is judged as the call having thrown what it threw", async () => {
        const host = createTestHost();
        const child = createChild(host);
        const facts = await child.open(openRequest("src/flaky.ts", []));
        assert.equal(facts.loadProblem, undefined);
        const called = await child.call("src/flaky.ts:steady;seed=7", true);
        assert.deepEqual(called.failures.map((failure) => failure.kind), ["crash"]);
        assert.match(called.failures[0]!.message, /^The call to steady crashed with TypeError/);
        //
        // The copy's top level ran as far as the line that threw, and the function was never
        // called.
        //
        assert.deepEqual(called.exercised, [pathKey("src/flaky.ts", "(top level):entered"), pathKey("src/flaky.ts", "if:2:true")]);
        assert.equal(host.loads.count, 2);
    });

    test("a copy that fails to load says so, with what it threw", async () => {
        const host = createTestHost();
        const state = createTestState(host);
        await openShard(state, openRequest("src/flaky.ts", []));
        const shard = state.shard;
        assert.ok(shard);
        const steady = shard.functions.get("steady");
        assert.ok(steady);
        const modules = await loadCopies(state, shard, new RunSubject(7, undefined), steady);
        runWith(undefined);
        assert.equal(modules.loadFailed, true);
        assert.match(String(modules.loadError), /^TypeError/);
        assert.equal(modules.exports, undefined);
    });

    test("a factory class gives the same value for the same choice on every call", async () => {
        const child = createChild(createTestHost());
        const facts = await child.open(openRequest("src/boxes.ts", ["src/boxes.sim.ts"]));
        const size = facts.functions.find((plan) => plan.name === "size");
        assert.ok(size);
        assert.deepEqual(size.choices[0]!.map((choice) => `${choice.source}${choice.index}`), ["factory0", "factory1", "factory2"]);
        const first = await child.call("src/boxes.ts:size;seed=7;values=f1", true);
        const again = await child.call("src/boxes.ts:size;seed=7;values=f1", true);
        assert.deepEqual(first.arguments, ["{ count: 2 }"]);
        assert.deepEqual(again.arguments, first.arguments);
        assert.deepEqual((await child.call("src/boxes.ts:size;seed=7;values=f0", true)).arguments, ["{ count: 1 }"]);
    });
});

describe("startCopies", () => {
    test("each new number becomes the copy number and a copy is imported under the number given last", async () => {
        const host = createTestHost();
        const state = createTestState(host);
        startCopies(state);
        assert.equal(state.copyNumber, 1);
        startCopies(state);
        assert.equal(state.copyNumber, 2);
        assert.equal(state.numbersGiven, 2);
        await importCopy(state, "src/plain.ts");
        assert.deepEqual(host.imported, [`${fileUrl(projectRoot, "src/plain.ts")}?flt=2`]);
    });
});

describe("importFresh", () => {
    test("a fresh import carries the copy number with a number no other import has", async () => {
        const host = createTestHost();
        const state = createTestState(host);
        startCopies(state);
        await importFresh(state, "src/plain.ts");
        await importFresh(state, "src/plain.ts");
        assert.deepEqual(host.imported, [
            `${fileUrl(projectRoot, "src/plain.ts")}?flt=1&fresh=2`,
            `${fileUrl(projectRoot, "src/plain.ts")}?flt=1&fresh=3`,
        ]);
        assert.equal(state.copyNumber, 1);
        assert.equal(state.numbersGiven, 3);
    });
});

describe("importCopy", () => {
    test("no copy and no fresh import is made before a number is given out", () => {
        const state = createTestState(createTestHost());
        assert.throws(() => importCopy(state, "src/plain.ts"), /A copy was imported before any number was given out\./);
        assert.throws(() => importFresh(state, "src/plain.ts"), /A file was imported afresh before any number was given out\./);
        assert.throws(() => importCopy(state, path.join(projectRoot, "src/plain.ts")));
    });
});

describe("loadCopies", () => {
    test("loading copies imports the source and every sim file that loaded with injection off, then gives the call's value context its factories", async () => {
        const host = createTestHost();
        const state = createTestState(host);
        await openShard(state, openRequest("src/boxes.ts", ["src/boxes.sim.ts"]));
        const shard = state.shard;
        assert.ok(shard);
        const size = shard.functions.get("size");
        assert.ok(size);
        const subject = new RunSubject(7, undefined);
        const modules = await loadCopies(state, shard, subject, size);
        runWith(undefined);
        assert.equal(modules.loadFailed, false);
        assert.equal(modules.loadError, undefined);
        assert.ok(modules.exports);
        assert.equal(typeof modules.exports["size"], "function");
        assert.deepEqual([...modules.simExports.keys()], ["src/boxes.sim.ts"]);
        assert.deepEqual(subject.injector.reached, []);
        const context = callContext(shard, modules, size);
        assert.equal(context.seed, 7);
        assert.equal(context.factories.count(size.parameters[0]!.recipe.kind === "named" ? size.parameters[0]!.recipe.key : ""), 3);
    });

    test("a scenario's copies leave the source file alone and so does a call of the top level", async () => {
        const host = createTestHost();
        const state = createTestState(host);
        await openShard(state, openRequest("src/calc.ts", ["src/calc.sim.ts"]));
        const shard = state.shard;
        assert.ok(shard);
        const forScenario = await loadCopies(state, shard, new RunSubject(7, undefined), undefined);
        assert.equal(forScenario.exports, undefined);
        const forTop = await loadCopies(state, shard, new RunSubject(7, undefined), shard.functions.get("(top level)"));
        runWith(undefined);
        assert.equal(forTop.exports, undefined);
        assert.equal(forTop.simExports.size, 1);
    });

    test("copies are loaded only for the shard that is open", async () => {
        const host = createTestHost();
        const state = createTestState(host);
        await openShard(state, openRequest("src/plain.ts", []));
        const shard = state.shard;
        assert.ok(shard);
        state.shard = undefined;
        await assert.rejects(loadCopies(state, shard, new RunSubject(7, undefined), undefined), /Copies were loaded for a shard that is not the one open\./);
        assert.equal(state.copyNumber, 1);
    });
});

//
// A child whose answers are made up, so serving it checks only the order and the replies.
//
export function createAnsweringChild(): IChild {
    return {
        open: async (request: IOpenRequest) => emptyFacts(request.file, [], undefined),
        call: async (token: string) => ({
            token,
            exercised: [],
            reached: [],
            injected: false,
            failures: [],
            arguments: [],
        }),
        read: async () => ["src/served.ts\tserved:entered"],
    };
}

//
// A source of messages that a test delivers each message through.
//
export interface ITestSource extends IMessageSource {
    //
    // Sends one message to the listener `serveChild` gave.
    //
    deliver(message: unknown): void;
}

//
// A source of messages that holds the listener it is given, so a test can deliver each message.
//
export function createTestSource(): ITestSource {
    const listeners: ((message: unknown) => void)[] = [];
    return {
        on: (_event: "message", listener: (message: unknown) => void) => {
            listeners.push(listener);
        },
        deliver: (message: unknown) => {
            assert.equal(listeners.length, 1);
            listeners[0]!(message);
        },
    };
}

//
// Gives the event loop turns until `isDone` says yes, so a test waits on the child's promises and
// no timer.
//
export async function waitUntil(isDone: () => boolean): Promise<void> {
    for (let turn = 0; turn < turnsWaitedMost; turn += 1) {
        if (isDone()) {
            return;
        }
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
    }
    assert.fail(`The child had not answered after ${turnsWaitedMost} turns of the event loop.`);
}

//
// The most turns `waitUntil` gives. A reply made up in memory comes within a few turns, so this
// many means the child never answered.
//
export const turnsWaitedMost = 100;

describe("serveChild", () => {
    test("requests are answered in order, each after the reply to the one before", async () => {
        const sent: IReply[] = [];
        const failed: unknown[] = [];
        const source = createTestSource();
        serveChild(createAnsweringChild(), source, (message: IReply) => sent.push(message), (error: unknown) => failed.push(error));
        source.deliver(openRequest("src/served.ts", []));
        await waitUntil(() => sent.length === 1);
        source.deliver({
            kind: "call",
            token: "src/served.ts:served;seed=7",
            read: false,
        });
        await waitUntil(() => sent.length === 2);
        source.deliver({
            kind: "read",
        });
        await waitUntil(() => sent.length === 3);
        assert.deepEqual(sent.map((reply) => reply.kind), ["opened", "called", "read"]);
        assert.deepEqual(sent[2], {
            kind: "read",
            exercised: ["src/served.ts\tserved:entered"],
        });
        assert.deepEqual(failed, []);
    });

    test("a request the child does not know is a failure of its own while the child goes on serving", async () => {
        const sent: IReply[] = [];
        const failed: unknown[] = [];
        const source = createTestSource();
        serveChild(createAnsweringChild(), source, (message: IReply) => sent.push(message), (error: unknown) => failed.push(error));
        source.deliver({
            kind: "unknown",
        });
        await waitUntil(() => failed.length === 1);
        source.deliver("not even an object");
        await waitUntil(() => failed.length === 2);
        source.deliver(openRequest("src/served.ts", []));
        await waitUntil(() => sent.length === 1);
        assert.match(String(failed[0]), /The child was sent a request it does not know\./);
        assert.match(String(failed[1]), /The child was sent something that is not a request\./);
    });

    test("a request sent while another waits for its reply is a failure while the waiting one is still answered", async () => {
        const sent: IReply[] = [];
        const failed: unknown[] = [];
        const source = createTestSource();
        serveChild(createAnsweringChild(), source, (message: IReply) => sent.push(message), (error: unknown) => failed.push(error));
        for (let request = 0; request <= requestsWaitingMost; request += 1) {
            source.deliver(openRequest("src/served.ts", []));
        }
        await waitUntil(() => sent.length === requestsWaitingMost);
        assert.equal(failed.length, 1);
        assert.match(String(failed[0]), /^Error: The worker sent a request while 1 waited for a reply\./);
    });
});

describe("answerRequest", () => {
    test("every request is checked before it is answered", async () => {
        const child = createAnsweringChild();
        const sent: IReply[] = [];
        await assert.rejects(answerRequest(child, null, (message: IReply) => sent.push(message)), /not a request/);
        await assert.rejects(answerRequest(child, {}, (message: IReply) => sent.push(message)), /not a request/);
        await assert.rejects(answerRequest(child, {
            kind: "call",
        }, (message: IReply) => sent.push(message)), /a call with no token/);
        await assert.rejects(answerRequest(child, {
            kind: "call",
            token: 7,
        }, (message: IReply) => sent.push(message)), /whose token is not text/);
        await assert.rejects(answerRequest(child, {
            kind: "call",
            token: "src/served.ts:served;seed=7",
        }, (message: IReply) => sent.push(message)), /does not say whether to read coverage/);
        await assert.rejects(answerRequest(child, {
            kind: "call",
            token: "src/served.ts:served;seed=7",
            read: "yes",
        }, (message: IReply) => sent.push(message)), /whose read is not true or false/);
        assert.deepEqual(sent, []);
    });
});

describe("isOpenRequest", () => {
    test("an open request is one with every field the worker writes", () => {
        const request = openRequest("src/served.ts", ["src/served.sim.ts"]);
        assert.equal(isOpenRequest(request), true);
        assert.equal(isOpenRequest({}), false);
        assert.equal(isOpenRequest({
            ...request,
            kind: "call",
        }), false);
        assert.equal(isOpenRequest({
            kind: "open",
        }), false);
        assert.equal(isOpenRequest({
            ...request,
            file: 7,
        }), false);
        assert.equal(isOpenRequest({
            kind: "open",
            file: "src/served.ts",
        }), false);
        assert.equal(isOpenRequest({
            ...request,
            sims: "src/served.sim.ts",
        }), false);
        assert.equal(isOpenRequest({
            ...request,
            sims: [7],
        }), false);
        assert.equal(isOpenRequest({
            kind: "open",
            file: "src/served.ts",
            sims: [],
        }), false);
        assert.equal(isOpenRequest({
            ...request,
            seed: "7",
        }), false);
    });
});

describe("isChildSettings", () => {
    test("the child's settings are ones with every field the worker writes", () => {
        const settings: IChildSettings = {
            projectRoot,
            toolModules: projectRoot,
            simTypes: [simTypesFile],
            limits: {
                wallMs: 200,
                afterSettleMs: 60000,
            },
        };
        assert.equal(isChildSettings(settings), true);
        assert.equal(isChildSettings("settings"), false);
        assert.equal(isChildSettings(null), false);
        assert.equal(isChildSettings({}), false);
        assert.equal(isChildSettings({
            ...settings,
            projectRoot: 7,
        }), false);
        assert.equal(isChildSettings({
            projectRoot,
        }), false);
        assert.equal(isChildSettings({
            ...settings,
            toolModules: 7,
        }), false);
        assert.equal(isChildSettings({
            projectRoot,
            toolModules: projectRoot,
        }), false);
        assert.equal(isChildSettings({
            ...settings,
            simTypes: simTypesFile,
        }), false);
        assert.equal(isChildSettings({
            ...settings,
            simTypes: [7],
        }), false);
        assert.equal(isChildSettings({
            projectRoot,
            toolModules: projectRoot,
            simTypes: [],
        }), false);
        assert.equal(isChildSettings({
            ...settings,
            limits: {
                wallMs: 200,
            },
        }), false);
    });
});

//
// A file system that fails every read with an error Node never raises, which only a defect in the
// file system it stands for would give.
//
export function createUncodedFileSystem(): IFileSystem {
    const files = createFakeProject(projectFiles);
    return {
        readText: () => Promise.reject(new Error("The read failed without a code.")),
        isFile: (file: string) => files.isFile(file),
        isDirectory: (directory: string) => files.isDirectory(directory),
        listDirectory: (directory: string) => files.listDirectory(directory),
        realPath: (file: string) => files.realPath(file),
        writeText: (file: string, text: string) => files.writeText(file, text),
        rename: (from: string, to: string) => files.rename(from, to),
        makeDirectory: (directory: string) => files.makeDirectory(directory),
        removeDirectory: (directory: string) => files.removeDirectory(directory),
    };
}

describe("unbuildableType", () => {
    test("the type no value is built for is the first parameter with no choice, and none when every parameter has one", () => {
        const info: FunctionInfo = {
            label: "store",
            file: "src/a.ts",
            line: 1,
            reach: {
                how: "module",
            },
            parameters: ["count", "store"].map((name) => ({
                name,
                typeName: name === "count" ? "number" : "Store",
                recipe: {
                    kind: "number",
                },
                optional: false,
                rest: false,
            })),
            async: false,
        };
        const value: IChoice = {
            source: "boundary",
            index: 0,
        };
        assert.equal(unbuildableType(info, [[value], []]), "Store");
        assert.equal(unbuildableType(info, [[], []]), "number");
        assert.equal(unbuildableType(info, [[value], [value]]), undefined);
        assert.equal(unbuildableType(info, []), undefined);
        assert.throws(() => unbuildableType(info, [[value]]), assert.AssertionError);
    });
});

describe("readSourceText", () => {
    test("a file's text is read and a file that is not there has none", async () => {
        const files = createFakeProject(projectFiles);
        assert.equal(await readSourceText(files, path.join(projectRoot, "src/plain.ts")), "export function one(): number {\n    return 1;\n}\n");
        assert.equal(await readSourceText(files, path.join(projectRoot, "src/gone.ts")), undefined);
    });

    test("a read that fails without a code is a defect, as is a path that is not absolute", async () => {
        await assert.rejects(readSourceText(createUncodedFileSystem(), path.join(projectRoot, "src/plain.ts")), /not an error Node raised/);
        await assert.rejects(readSourceText(createFakeProject(projectFiles), "src/plain.ts"), /not an absolute path/);
    });
});

describe("fileUrl", () => {
    test("a project file's URL is its path from the root, which is never absolute", () => {
        assert.equal(fileUrl("/project", "src/served.ts"), "file:///project/src/served.ts");
        assert.throws(() => fileUrl("/project", "/project/src/served.ts"), /not a path relative to the project root/);
        assert.throws(() => fileUrl("project", "src/served.ts"));
    });
});

describe("emptyFacts", () => {
    test("a shard's facts start empty, for a file named from the project root", () => {
        assert.deepEqual(emptyFacts("src/served.ts", ["a problem"], "it failed"), {
            file: "src/served.ts",
            functions: [],
            scenarios: [],
            paths: [],
            notProvable: [],
            uncallable: [],
            simProblems: ["a problem"],
            loadProblem: "it failed",
        });
        assert.throws(() => emptyFacts("", [], undefined));
        assert.throws(() => emptyFacts(path.join(projectRoot, "src/served.ts"), [], undefined), /not a path relative to the project root/);
    });
});

describe("isStop", () => {
    test("only a call of process.exit and an expectation that did not hold stop the code", () => {
        assert.equal(isStop(new ProcessExitCalled(3)), true);
        assert.equal(isStop(new ExpectationStop("to hold")), true);
        assert.equal(isStop(new Error("crash")), false);
        assert.equal(isStop(undefined), false);
    });
});

describe("callExported", () => {
    test("an exported function is called with the values while anything else exported is a defect", () => {
        const exports: Record<string, unknown> = {
            twice: (value: number) => value * 2,
            count: 1,
        };
        assert.equal(callExported(exports, "twice", [4]), 8);
        assert.throws(() => callExported(exports, "count", []), /The file exports no function count\./);
        assert.throws(() => callExported(exports, "", []));
    });
});

describe("describeValues", () => {
    test("values are written on one line without running a getter or the value's own inspect", () => {
        let isRead = false;
        const holder = {
            get secret(): number {
                isRead = true;
                return 1;
            },
            [Symbol.for("nodejs.util.inspect.custom")](): string {
                return "custom";
            },
            nested: {
                first: {
                    second: {
                        third: {
                            fourth: 1,
                        },
                    },
                },
            },
        };
        const [written] = describeValues([holder]);
        assert.equal(isRead, false);
        assert.notEqual(written, "custom");
        assert.match(written!, /^\{ secret: \[Getter\],/);
        assert.equal(written!.includes("\n"), false);
        assert.match(written!, /\[Object\]/);
        assert.deepEqual(describeValues([0, "text", undefined, [1, 2]]), ["0", "'text'", "undefined", "[ 1, 2 ]"]);
    });

    test("an error, whose stack runs over several lines, is written on one line", () => {
        const error = new Error("Rate exceeded");
        Reflect.set(error, "$metadata", {
            requestId: "a1b2",
        });
        const [written] = describeValues([error]);
        assert.ok(written !== undefined);
        assert.equal(written.includes("\n"), false);
        assert.match(written, /^\{ Error: Rate exceeded at /);
        assert.match(written, /requestId: 'a1b2'/);
    });
});

//
// A value context with no conditions and no value factories.
//
export function plainValueContext(): IValueContext {
    return createValueContext(1, [], createFactoryTable([], new Map()));
}

describe("values that cannot be built", () => {
    test("a value factory that throws stops the call with what it threw, which is reported as a failure of its own", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/fragile.ts", ["src/fragile.sim.ts"]));
        const result = await child.call("src/fragile.ts:count;seed=7;values=f0", true);
        assert.deepEqual(failureLines(result), ["crash: The call to count was not made, because building its values failed with Error: no shelf to build."]);
        assert.deepEqual(result.arguments, []);
        assert.equal(result.exercised.some((key) => key.endsWith("count:entered")), false);
    });

    test("a value factory for the instance a method is called on that throws is reported the same way", async () => {
        const child = createChild(createTestHost());
        await child.open(openRequest("src/fragile.ts", ["src/fragile.sim.ts"]));
        const result = await child.call("src/fragile.ts:Rack.size;seed=7;values=f0", true);
        assert.deepEqual(failureLines(result), ["crash: The call to Rack.size was not made, because building its values failed with Error: no rack to build."]);
    });

    test("building values stops with what it threw, and building an instance does too", () => {
        assert.throws(() => buildCallValues(plainValueContext(), [], [{ source: "boundary", index: 0 }], []), ValuesNotBuilt);
        assert.throws(() => buildReceiver(plainValueContext(), "src/none.ts#None", 0), ValuesNotBuilt);
    });
});

describe("useMember", () => {
    test("a member is called, read or set on its target", () => {
        const target = {
            value: 1,
            twice(given: number): number {
                return given * 2;
            },
        };
        assert.equal(useMember(target, "twice", "none", [4]), 8);
        assert.equal(useMember(target, "value", "get", []), 1);
        assert.equal(useMember(target, "value", "set", [5]), true);
        assert.equal(target.value, 5);
    });

    test("a getter is given no value, a setter one and a method has to be a function", () => {
        const target = {
            value: 1,
        };
        assert.throws(() => useMember(target, "value", "get", [1]), /The getter value was given values\./);
        assert.throws(() => useMember(target, "value", "set", []), /The setter value was not given one value\./);
        assert.throws(() => useMember(target, "value", "none", []), /There is no method value\./);
        assert.equal(target.value, 1);
    });
});
