//
// What the child process does: opens the shard the worker names and makes each call the worker
// sends it as a replay token.
//
// Per call it loads copies of the project's modules of its own (so no call sees state an earlier
// call left in them), builds the values, makes the call with a run in flight, waits for the call to
// settle and for simulated time to run out, reads coverage, runs the expectation functions of the
// shard's sim files with injection switched off and hands back the code paths exercised, the places
// reached and the failures found.
//
// Everything the child touches outside itself is passed in, so the same code runs in the child
// process and in a test.
//

import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import type { ScriptCoverage } from "../coverage/v8.ts";
import type { ClassInfo, FunctionInfo } from "../discover/functions.ts";
import { isSimFile } from "../discover/sources.ts";
import { isCodedError, type IFileSystem } from "../lib/file-system.ts";
import { numberedUrl, type ILoader } from "../load/hooks.ts";
import { buildArguments, buildBaseline, createValueContext, factoryCount, listParameterChoices, makeWithFactory, type IValueContext } from "../values/build.ts";
import type { IChoice } from "../values/choices.ts";
import { createFactoryTable, type SimExports } from "../values/factories.ts";
import { runInContext, runWith } from "../world/current.ts";
import { ProcessExitCalled, RunSubject } from "../world/subject.ts";
import { isCallLimits, makeCall, type ICallOutcome, type ICallWatch, type IEventLoop } from "./call.ts";
import { createExpectationContext, createScenarioContext, ExpectationStop, type IExpectationRecord } from "./contexts.ts";
import { describeError, judgeExpectation, judgeHang, judgeThrown, judgeUncaught, judgeUnbuiltValues, subjectOf, type IFailure, type IJudgeContext } from "./judge.ts";
import { exercisedKeys, pathKey } from "./measure.ts";
import type { ICalledReply, ICallResult, IChildSettings, IFunctionPlan, IOpenedReply, IOpenRequest, IPathRecord, IReadReply, IReply, IShardFacts } from "./messages.ts";
import { functionKey, targetLabels, type IShardReading } from "./shard.ts";
import type { IShardReader } from "./shard-reader.ts";
import { readToken, type IReplayToken } from "./token.ts";

//
// What the child is wired to.
//
export interface IChildHost {
    //
    // What the child was started with.
    //
    settings: IChildSettings;

    //
    // The loader on the child's own thread. The judge reads the text of a crashing file through
    // its file system.
    //
    loader: ILoader;

    //
    // What reads each shard with the compiler and finds the code paths of each file it measures.
    //
    reader: IShardReader;

    //
    // Imports a file of the project by its URL, through the module hooks.
    //
    importFile(url: string): Promise<Record<string, unknown>>;

    //
    // Reads V8's coverage since the last reading, which resets it.
    //
    takeCoverage(): Promise<ScriptCoverage[]>;

    //
    // The event loop a call is waited on: the wall clock, its turns and the real work under way.
    //
    eventLoop: IEventLoop;

    //
    // Where the child's listeners put the errors no code caught.
    //
    watch: ICallWatch;
}

//
// One shard the child has open.
//
export interface IOpenShard {
    //
    // What the worker asked for.
    //
    request: IOpenRequest;

    //
    // What the compiler read.
    //
    reading: IShardReading;

    //
    // What the worker was told.
    //
    facts: IShardFacts;

    //
    // What the shard's source file exports, or undefined for a sim file or a file that failed to
    // load.
    //
    exports: Record<string, unknown> | undefined;

    //
    // Whether the source file's top level ended the process while it was loaded, which leaves it
    // with nothing exported and is no failure.
    //
    endedWhileLoading: boolean;

    //
    // What each sim file that loaded exports, by its path relative to the project root.
    //
    simExports: Map<string, SimExports>;

    //
    // Each function of a source file, by the name a token names it with.
    //
    functions: Map<string, FunctionInfo>;
}

//
// The copies of the shard's modules one call is made with.
//
export interface ICallModules {
    //
    // What the copy of the shard's source file exports, or undefined when the call does not need it
    // (a call of the top level, which imports the file itself, or a scenario).
    //
    exports: Record<string, unknown> | undefined;

    //
    // What the copy of each sim file that loaded when the shard was opened exports, by its path
    // relative to the project root.
    //
    simExports: Map<string, SimExports>;

    //
    // Whether loading the copies threw.
    //
    loadFailed: boolean;

    //
    // What loading the copies threw, when `loadFailed` says it did. Code can throw any value,
    // `undefined` included, which is why whether it threw is a field of its own.
    //
    loadError: unknown;
}

//
// The child: the shard it has open and the calls it makes in it.
//
export interface IChild {
    //
    // Opens a shard and says what is in it.
    //
    open(request: IOpenRequest): Promise<IShardFacts>;

    //
    // Makes the call a token names in the shard that is open, taking a coverage reading after it
    // when `reading` says so.
    //
    call(token: string, reading: boolean): Promise<ICallResult>;

    //
    // Takes a coverage reading and gives the keys of the code paths the calls since the last one
    // exercised.
    //
    read(): Promise<string[]>;
}

//
// What a child keeps between one request and the next.
//
export interface IChildState {
    //
    // What it is wired to.
    //
    host: IChildHost;

    //
    // How crashes are judged.
    //
    judge: IJudgeContext;

    //
    // The shard that is open.
    //
    shard: IOpenShard | undefined;

    //
    // How many numbers it has given out, to sets of copies and to fresh imports alike, so that
    // every number names URLs no other import has.
    //
    numbersGiven: number;

    //
    // The number of the copies of the project's modules the call in flight is made with. A project
    // file imports the copies of the number in its own URL, so every file of one call's copies
    // imports the others of the same call.
    //
    copyNumber: number;
}

//
// The most requests the child holds at once. The worker waits for the reply to each request before
// it sends the next, so a second one waiting is a defect in Faultline.
//
export const requestsWaitingMost = 1;

//
// Builds a child wired to `host`.
//
export function createChild(host: IChildHost): IChild {
    assert(path.isAbsolute(host.settings.projectRoot));
    assert(path.isAbsolute(host.settings.toolModules));
    const state: IChildState = {
        host,
        judge: {
            projectRoot: host.settings.projectRoot,
            readSource: (file: string) => readSourceText(host.loader.reading.fileSystem, file),
        },
        shard: undefined,
        numbersGiven: 0,
        copyNumber: 0,
    };
    return {
        open: (request: IOpenRequest) => openShard(state, request),
        call: (token: string, reading: boolean) => makeTokenCall(state, token, reading),
        read: () => readCoverage(state),
    };
}

//
// The text of a file, or undefined when it cannot be read. A frame naming a file that has gone is
// judged without its text, which the judge allows for.
//
export async function readSourceText(files: IFileSystem, file: string): Promise<string | undefined> {
    assert(path.isAbsolute(file), `The judge asked for ${file}, which is not an absolute path.`);
    try {
        return await files.readText(file);
    }
    catch (error) {
        assert(isCodedError(error), `Reading ${file} failed with something that is not an error Node raised.`);
        return undefined;
    }
}

//
// The keys of the code paths exercised since the last coverage reading.
//
export async function readCoverage(state: IChildState): Promise<string[]> {
    assert(state.shard !== undefined, "A coverage reading was asked for before any shard was opened.");
    const exercised = await exercisedKeys(await state.host.takeCoverage(), state.host.reader);
    assert(exercised.every((key) => key.length > 0));
    return exercised;
}

//
// Whether any sim file of the shard has an expectation function, which runs after every call.
//
export function runsExpectations(shard: IOpenShard): boolean {
    assert(Array.isArray(shard.reading.sims));
    return shard.reading.sims.some((sim) => sim.expectations.length > 0);
}

//
// The URL of a project file, named by its path relative to the project root.
//
export function fileUrl(projectRoot: string, file: string): string {
    assert(path.isAbsolute(projectRoot));
    assert(!path.isAbsolute(file), `${file} is not a path relative to the project root.`);
    return pathToFileURL(path.join(projectRoot, file)).href;
}

//
// Imports a file of the project afresh, so its top level runs again, by giving it a URL of its own.
// The URL carries the number of the call in flight too, so the files it imports are that call's
// copies.
//
export function importFresh(state: IChildState, file: string): Promise<Record<string, unknown>> {
    assert(state.copyNumber > 0, "A file was imported afresh before any number was given out.");
    state.numbersGiven += 1;
    assert(state.numbersGiven > state.copyNumber);
    return state.host.importFile(`${numberedUrl(path.join(state.host.settings.projectRoot, file), state.copyNumber)}&fresh=${state.numbersGiven}`);
}

//
// Gives out a new number for the copies of the project's modules loaded from here on, so every
// project file imported next is a copy of its own.
//
export function startCopies(state: IChildState): void {
    assert(state.copyNumber <= state.numbersGiven);
    state.numbersGiven += 1;
    state.copyNumber = state.numbersGiven;
    assert(state.copyNumber > 0);
}

//
// Imports the copy of a file of the project that belongs to the number given out last, the same
// copy every other project file of that call imports.
//
export function importCopy(state: IChildState, file: string): Promise<Record<string, unknown>> {
    assert(state.copyNumber > 0, "A copy was imported before any number was given out.");
    assert(!path.isAbsolute(file), `${file} is not a path relative to the project root.`);
    return state.host.importFile(numberedUrl(path.join(state.host.settings.projectRoot, file), state.copyNumber));
}

//
// Opens a shard: reads it, loads its file and its sim files with a run in flight that injects
// nothing and records nothing, then lists what the worker can call in it.
//
export async function openShard(state: IChildState, request: IOpenRequest): Promise<IShardFacts> {
    const reading = await state.host.reader.read(request.file, request.sims);
    const loading = new RunSubject(request.seed, undefined);
    loading.injector.setInjecting(false);
    runWith(loading);
    startCopies(state);
    let exports: Record<string, unknown> | undefined;
    let loadProblem = parseProblem(request.file, reading.parseErrors);
    let endedWhileLoading = false;
    if (reading.facts) {
        if (!loadProblem) {
            try {
                exports = await importCopy(state, request.file);
            }
            catch (error) {
                //
                // A file whose top level ends the process, as an entry point does when its settings
                // are missing, has not failed to load: ending the process is what it does. Only a
                // scenario that gives it what it needs and loads it reaches the rest.
                //
                if (error instanceof ProcessExitCalled) {
                    endedWhileLoading = true;
                }
                else {
                    loadProblem = `${request.file} failed to load, so only its top level is called: ${describeError(error)}.`;
                }
            }
        }
    }
    const simProblems: string[] = [];
    const simExports = new Map<string, SimExports>();
    for (const sim of reading.sims) {
        for (const problem of sim.typeErrors) {
            simProblems.push(`The sim file ${sim.file} has an error: ${problem}`);
        }
        try {
            simExports.set(sim.file, await importCopy(state, sim.file));
        }
        catch (error) {
            simProblems.push(`The sim file ${sim.file} failed to load: ${describeError(error)}.`);
        }
    }

    //
    // Loading ran the files' top levels, which is not a call of anything. The top level is called
    // on its own, so this reading is thrown away.
    //
    await state.host.takeCoverage();
    const factories = reading.sims.filter((sim) => simExports.has(sim.file)).flatMap((sim) => sim.factories);
    const table = createFactoryTable(factories, simExports);
    const shard: IOpenShard = {
        request,
        reading,
        facts: emptyFacts(request.file, simProblems, loadProblem),
        exports,
        endedWhileLoading,
        simExports,
        functions: new Map(),
    };
    if (!reading.facts) {
        assert.equal(reading.sims.length, 1, `The sim file ${request.file} was opened with sim files other than itself.`);
        const sim = reading.sims[0];
        assert(sim !== undefined);
        assert.equal(sim.file, request.file);
        if (simExports.has(sim.file)) {
            shard.facts.scenarios = sim.scenarios.map((scenario) => ({
                name: scenario.exportName,
                line: scenario.line,
            }));
        }
        state.shard = shard;
        return shard.facts;
    }

    //
    // A file that does not parse was not loaded, so it has no functions to call and no code paths
    // to count. The problem line says so and the run exits 1.
    //
    if (reading.parseErrors.length > 0) {
        assert(exports === undefined);
        state.shard = shard;
        return shard.facts;
    }
    const measured = await state.host.reader.measure(fileUrl(state.host.settings.projectRoot, request.file));
    assert(measured !== undefined, `${request.file} is no source file Faultline measures.`);
    shard.facts.paths = measured.paths.map((measuredPath): IPathRecord => ({
        key: pathKey(measuredPath.path.file, measuredPath.path.name),
        file: measuredPath.path.file,
        line: measuredPath.path.line,
        fn: measuredPath.path.fn,
        describe: measuredPath.path.describe,
    }));
    shard.facts.notProvable = measured.notProvable;
    shard.facts.uncallable = reading.facts.uncallable;
    for (const info of reading.facts.functions) {
        //
        // Discovery and the condition reader list the same functions, so every one has its list.
        //
        const conditions = reading.conditions.get(functionKey(info.label, info.line));
        assert(conditions !== undefined, `No conditions were read for ${info.label} on line ${info.line}.`);
        const context = createValueContext(request.seed, conditions, table);
        const name = shard.functions.has(info.label) ? functionKey(info.label, info.line) : info.label;
        assert(!shard.functions.has(name), `${request.file} has two functions called ${info.label} on line ${info.line}.`);
        shard.functions.set(name, info);
        shard.facts.functions.push(functionPlan(shard, info, name, context));
    }
    state.shard = shard;
    return shard.facts;
}

//
// The problem line for a source file that does not parse, with every place the compiler said it
// does not, or undefined for a file that parses.
//
export function parseProblem(file: string, parseErrors: string[]): string | undefined {
    assert(file.length > 0);
    assert(Array.isArray(parseErrors));
    if (parseErrors.length === 0) {
        return undefined;
    }
    return `${file} does not parse, so it was not loaded: ${parseErrors.join(" ")}`;
}

//
// The facts of a shard before anything is listed in them.
//
export function emptyFacts(file: string, simProblems: string[], loadProblem: string | undefined): IShardFacts {
    assert(file.length > 0);
    assert(!path.isAbsolute(file), `${file} is not a path relative to the project root.`);
    return {
        file,
        functions: [],
        scenarios: [],
        paths: [],
        notProvable: [],
        uncallable: [],
        simProblems,
        loadProblem,
    };
}

//
// What the worker needs to plan one function's calls.
//
export function functionPlan(shard: IOpenShard, info: FunctionInfo, name: string, context: IValueContext): IFunctionPlan {
    const facts = shard.reading.facts;
    assert(facts !== undefined, `${shard.request.file} is a sim file, which has no functions to plan.`);
    let uncallable: string | undefined;
    if (info.reach.how === "inside") {
        uncallable = info.reach.because;
    }
    else {
        if (!shard.exports) {
            if (info.reach.how !== "module") {
                uncallable = shard.endedWhileLoading ? "its file ends the process when it is loaded, so only a scenario that loads it with what it needs reaches it" : "its file failed to load";
            }
        }
    }
    const labels = targetLabels(facts.functions, info.label);
    assert(labels.includes(info.label), `The paths of ${info.label} are not among the paths it waits for.`);
    const parameterChoices = uncallable === undefined ? listParameterChoices(context, info.parameters) : [];
    const receivers = uncallable === undefined ? receiverChoices(context, receiverKey(shard, info)) : [];
    const choices = receivers.length > 0 ? [receivers, ...parameterChoices] : parameterChoices;
    return {
        label: info.label,
        name,
        line: info.line,
        uncallable,
        unbuildable: unbuildableType(info, parameterChoices),
        choices,
        targets: shard.facts.paths.filter((record) => labels.includes(record.fn)).map((record) => record.key),
    };
}

//
// The key the value factories returning the class an instance method is called on are found by,
// or undefined for a function that is no instance method.
//
export function receiverKey(shard: IOpenShard, info: FunctionInfo): string | undefined {
    if (info.reach.how !== "method") {
        return undefined;
    }
    if (info.reach.onClass) {
        return undefined;
    }
    const key = `${shard.request.file}#${info.reach.className}`;
    assert(key.endsWith(`#${info.reach.className}`));
    return key;
}

//
// The instances an instance method is called on, as choices: one per value factory returning its
// class, as for a parameter of the class, or none when no factory returns it, and the instance is
// then built from each constructor parameter's first value. A replay token names the instance
// before the method's own values.
//
export function receiverChoices(context: IValueContext, key: string | undefined): IChoice[] {
    if (!key) {
        return [];
    }
    const count = factoryCount(context, key);
    const choices: IChoice[] = [];
    for (let index = 0; index < count; index += 1) {
        choices.push({
            source: "factory",
            index,
        });
    }
    assert.equal(choices.length, count);
    return choices;
}

//
// The type of the first parameter of `info` that `choices` holds no value for, or undefined when
// every parameter has one. A function with such a parameter is never called, and the checklist asks
// for a value factory returning that type. A function Faultline cannot call has no choices at all,
// and its own reason says why, so it has no such type.
//
export function unbuildableType(info: FunctionInfo, choices: IChoice[][]): string | undefined {
    if (choices.length === 0) {
        return undefined;
    }
    assert.equal(choices.length, info.parameters.length);
    const position = choices.findIndex((list) => list.length === 0);
    if (position < 0) {
        return undefined;
    }
    const parameter = info.parameters[position];
    assert(parameter !== undefined);
    return parameter.typeName;
}

//
// Makes the call a token names, in the shard that is open.
//
export async function makeTokenCall(state: IChildState, token: string, reading: boolean): Promise<ICallResult> {
    const read = readToken(token);
    assert(read.ok, `The worker sent a token the child cannot read: ${token}`);
    const call = read.value;
    const shard = state.shard;
    assert(shard !== undefined, "A call was sent before any shard was opened.");
    assert.equal(call.file, shard.request.file);
    assert.equal(call.seed, shard.request.seed);
    const host = state.host;
    const isScenario = isSimFile(call.file);
    const subject = new RunSubject(call.seed, call.failure);
    const records: IExpectationRecord[] = [];
    const modules = await runInContext(subject, () => loadCopies(state, shard, subject, isScenario ? undefined : shard.functions.get(call.name)));
    host.watch.uncaught.length = 0;
    const described: string[] = [];
    let outcome: ICallOutcome;
    if (modules.loadFailed) {
        outcome = {
            state: "threw",
            thrown: modules.loadError,
            uncaught: [],
        };
    }
    else {
        const invoke = isScenario ? () => invokeScenario(state, modules, call, subject, records) : () => invokeFunction(state, shard, modules, call, described);
        outcome = await makeCall(subject, invoke, host.settings.limits, host.eventLoop, host.watch);
    }

    //
    // The call is over: what the tool does from here is neither a place of it nor a failure in it.
    //
    subject.injector.setInjecting(false);
    //
    // A shard with expectation functions is read after every call, because what they run is read
    // and thrown away after them and would take the call's counts with it.
    //
    let exercised: string[] = [];
    if (reading || runsExpectations(shard)) {
        exercised = await readCoverage(state);
    }
    const reached = subject.injector.reached.map((reachedPlace) => ({
        place: {
            ...reachedPlace.place,
        },
        failures: [...reachedPlace.failures],
    }));
    const failures = await judgeOutcome(state, call, token, outcome, subject);
    if (!call.failure) {
        for (const record of records) {
            failures.push(judgeExpectation(record.expectation, call.name, record.location, token));
        }
    }
    host.watch.uncaught.length = 0;
    failures.push(...await runExpectations(state, shard, modules, subject, token));
    host.watch.uncaught.length = 0;
    return {
        token,
        exercised,
        reached,
        injected: subject.injector.injected,
        failures,
        arguments: described,
    };
}

//
// Loads the copies of the shard's modules one call is made with, under `subject` with injection
// switched off, so loading is neither a place of the call nor a failure in it. The modules belong
// to the call's own simulated world. `info` is the function called, or undefined for a
// scenario.
//
export async function loadCopies(state: IChildState, shard: IOpenShard, subject: RunSubject, info: FunctionInfo | undefined): Promise<ICallModules> {
    assert.equal(shard, state.shard, "Copies were loaded for a shard that is not the one open.");
    startCopies(state);
    runWith(subject);
    subject.injector.setInjecting(false);
    const modules: ICallModules = {
        exports: undefined,
        simExports: new Map(),
        loadFailed: false,
        loadError: undefined,
    };
    try {
        if (shard.exports) {
            if (info) {
                if (info.reach.how !== "module") {
                    modules.exports = await importCopy(state, shard.request.file);
                }
            }
        }
        for (const file of shard.simExports.keys()) {
            modules.simExports.set(file, await importCopy(state, file));
        }
    }
    catch (error) {
        //
        // The same files loaded when the shard was opened, so a copy that fails depends on
        // something that differs from load to load. The call is judged as having thrown it.
        //
        modules.loadFailed = true;
        modules.loadError = error;
    }
    if (!modules.loadFailed) assert.equal(modules.loadError, undefined);

    //
    // No coverage reading is taken here, so the call's reading counts what loading the copies ran
    // as well. That is the top levels of the files and what they call, which the call of the
    // file's top level, made first, already counts from copies of the same files. A reading costs
    // tens of milliseconds once the child holds many copies, and on 2026-10-26 the reading here
    // was a third of a call's time.
    //
    subject.injector.setInjecting(true);
    return modules;
}

//
// The failures one call's outcome shows: a crash, a call that never settled and an error no code
// caught. A call that called `process.exit` ended there, and what stopped it is no failure.
//
export async function judgeOutcome(state: IChildState, call: IReplayToken, token: string, outcome: ICallOutcome, subject: RunSubject): Promise<IFailure[]> {
    assert(token.length > 0);
    const failures: IFailure[] = [];
    const described = subjectOf(isSimFile(call.file), call.name);
    if (outcome.state === "threw") {
        if (outcome.thrown instanceof ValuesNotBuilt) {
            failures.push(judgeUnbuiltValues(call.file, call.name, described, outcome.thrown.cause, token));
        }
        else {
            if (!isStop(outcome.thrown)) {
                const crash = await judgeThrown(state.judge, outcome.thrown, described, token);
                if (crash) {
                    failures.push(crash);
                }
            }
        }
    }
    else {
        if (outcome.state === "pending") {
            failures.push(judgeHang(call.file, call.name, described, token));
        }
    }
    for (const error of outcome.uncaught) {
        if (!isStop(error)) {
            failures.push(judgeUncaught(state.judge, error, described, token));
        }
    }
    for (const failure of failures) {
        assert.equal(failure.token, token);
    }
    return failures;
}

//
// Whether something thrown is the run's own way of stopping the code: a call of `process.exit`,
// which ends the call as it would end the process and is no failure, because ending the process is
// how a program stops, or an expectation that did not hold, which is judged from what it wrote
// down.
//
export function isStop(thrown: unknown): boolean {
    if (thrown instanceof ProcessExitCalled) {
        return true;
    }
    return thrown instanceof ExpectationStop;
}

//
// Runs every expectation function of the shard's sim files after a call, with injection switched
// off so what they read neither fails nor moves the call's places.
//
export async function runExpectations(state: IChildState, shard: IOpenShard, modules: ICallModules, subject: RunSubject, token: string): Promise<IFailure[]> {
    assert(token.length > 0);
    subject.injector.setInjecting(false);
    const failures: IFailure[] = [];
    const host = state.host;
    let expectationCount = 0;
    for (const sim of shard.reading.sims) {
        const exports = modules.simExports.get(sim.file);
        if (!exports) {
            continue;
        }
        for (const expectation of sim.expectations) {
            expectationCount += 1;
            const run: unknown = exports[expectation.exportName];
            assert(typeof run === "function", `${sim.file} exports no function ${expectation.exportName}.`);
            const records: IExpectationRecord[] = [];
            const context = createExpectationContext(records, host.settings.projectRoot);
            const outcome = await makeCall(subject, () => Reflect.apply(run, undefined, [context]), host.settings.limits, host.eventLoop, host.watch);
            for (const record of records) {
                failures.push(judgeExpectation(record.expectation, expectation.exportName, record.location, token));
            }
            const described = `The expectation function ${expectation.exportName}`;
            if (outcome.state === "threw") {
                if (!isStop(outcome.thrown)) {
                    const crash = await judgeThrown(state.judge, outcome.thrown, described, token);
                    if (crash) {
                        failures.push(crash);
                    }
                }
            }
            else {
                if (outcome.state === "pending") {
                    failures.push(judgeHang(sim.file, expectation.exportName, described, token));
                }
            }
        }
    }
    if (expectationCount > 0) {
        //
        // The expectation functions ran code too, which is no call's doing, so what they ran is
        // read and thrown away before the next call.
        //
        await host.takeCoverage();
    }
    return failures;
}

//
// Runs the scenario a token names, with a context over the call's run.
//
export function invokeScenario(state: IChildState, modules: ICallModules, call: IReplayToken, subject: RunSubject, records: IExpectationRecord[]): unknown {
    const exports = modules.simExports.get(call.file);
    assert(exports !== undefined, `The sim file ${call.file} did not load.`);
    const scenario: unknown = exports[call.name];
    assert(typeof scenario === "function", `${call.file} exports no scenario ${call.name}.`);
    const context = createScenarioContext(subject, records, state.host.settings.projectRoot, (file: string) => importFresh(state, file));
    return Reflect.apply(scenario, undefined, [context]);
}

//
// Calls the function a token names, the way discovery says it is reached, with the values the token
// chose. It writes each value into `described` before the call can change it. It runs with the
// call's subject in flight, so the values are built inside the run, from the call's own copies of
// the sim files, so a factory class is built anew for the call and a value of one of the project's
// classes is an instance of the copy the call uses.
//
export function invokeFunction(state: IChildState, shard: IOpenShard, modules: ICallModules, call: IReplayToken, described: string[]): unknown {
    const info = shard.functions.get(call.name);
    assert(info !== undefined, `${call.file} has no function ${call.name}.`);
    const reach = info.reach;
    if (reach.how === "module") {
        return importFresh(state, call.file);
    }
    const exports = modules.exports;
    assert(exports !== undefined, `${call.file} did not load, so ${call.name} cannot be called.`);
    const context = callContext(shard, modules, info);
    const key = receiverKey(shard, info);
    const hasReceiver = receiverChoices(context, key).length > 0;
    const values = buildCallValues(context, info.parameters, hasReceiver ? call.values.slice(1) : call.values, described);
    if (reach.how === "export") {
        return callExported(exports, reach.name, values);
    }
    if (reach.how === "private") {
        return callExported(exports, reach.name, values);
    }
    if (reach.how === "construct") {
        return Reflect.construct(exportedClass(exports, reach.classExport), values);
    }
    if (reach.how === "method") {
        const owner = exportedClass(exports, reach.classExport);
        if (hasReceiver) {
            const receiver = call.values[0];
            assert(receiver !== undefined, `${call.name} in ${call.file} was called with no instance.`);
            assert.equal(receiver.source, "factory");
            assert(key !== undefined, `${call.name} in ${call.file} has an instance and no class.`);
            const instance = buildReceiver(context, key, receiver.index);
            assert(typeof instance === "object", `The value factory for ${reach.className} returned no object.`);
            assert(instance !== null, `The value factory for ${reach.className} returned null.`);
            return useMember(instance, reach.name, reach.accessor, values);
        }
        const target = reach.onClass ? owner : Reflect.construct(owner, constructorValues(shard, reach.className, context));
        return useMember(target, reach.name, reach.accessor, values);
    }
    assert(reach.how === "property", `${call.name} in ${call.file} is not a function Faultline calls.`);
    const holder: unknown = exports[reach.holder];
    assert(typeof holder === "object", `${call.file} exports no object ${reach.holder}.`);
    assert(holder !== null, `${call.file} exports null as ${reach.holder}.`);
    return useMember(holder, reach.name, reach.accessor, values);
}

//
// What stops a call whose values could not be built, carrying what building them threw. Building
// runs inside the call, because a value factory runs in the call's own simulated world, so what it
// throws would otherwise read as the function under test throwing, which is no failure, and the
// call would be lost without a word. The child judges it as a failure of its own.
//
export class ValuesNotBuilt {
    //
    // What building the values threw.
    //
    readonly cause: unknown;

    constructor(cause: unknown) {
        this.cause = cause;
    }
}

//
// Builds the values `choices` name for `parameters` and writes each out into `described`, or stops
// the call with `ValuesNotBuilt` when that fails.
//
export function buildCallValues(context: IValueContext, parameters: FunctionInfo["parameters"], choices: IChoice[], described: string[]): unknown[] {
    assert(Array.isArray(choices));
    assert(Array.isArray(described));
    try {
        const values = buildArguments(context, parameters, choices);
        described.push(...describeValues(values));
        return values;
    }
    catch (error) {
        throw new ValuesNotBuilt(error);
    }
}

//
// Builds the instance a method is called on with the value factory at `index` for `key`, or stops
// the call with `ValuesNotBuilt` when the factory throws.
//
export function buildReceiver(context: IValueContext, key: string, index: number): unknown {
    assert(key.length > 0);
    assert(index >= 0);
    try {
        return makeWithFactory(context, key, index);
    }
    catch (error) {
        throw new ValuesNotBuilt(error);
    }
}

//
// Calls the function a file exports under `name` with `values`.
//
export function callExported(exports: Record<string, unknown>, name: string, values: unknown[]): unknown {
    assert(name.length > 0);
    const called: unknown = exports[name];
    assert(typeof called === "function", `The file exports no function ${name}.`);
    return Reflect.apply(called, undefined, values);
}

//
// The value context one call's values are built in: the function's conditions, with the value
// factories of the call's own copies of the sim files.
//
export function callContext(shard: IOpenShard, modules: ICallModules, info: FunctionInfo): IValueContext {
    assert(shard.reading.facts !== undefined, `${shard.request.file} is a sim file, whose scenarios are built no values.`);
    const conditions = shard.reading.conditions.get(functionKey(info.label, info.line));
    assert(conditions, `No conditions were read for ${info.label} on line ${info.line}.`);
    const factories = shard.reading.sims.filter((sim) => modules.simExports.has(sim.file)).flatMap((sim) => sim.factories);
    return createValueContext(shard.request.seed, conditions, createFactoryTable(factories, modules.simExports));
}

//
// Each value as the crash view prints it: on one line, two levels deep, without colour and without
// calling a getter, so writing a value runs none of the code under test. An error is written with
// its stack, which runs over several lines whatever the line length, so the lines are joined.
//
export function describeValues(values: unknown[]): string[] {
    const written = values.map((value) => inspect(value, {
        depth: 2,
        colors: false,
        getters: false,
        breakLength: Infinity,
        compact: true,
        showProxy: false,
        customInspect: false,
    }).replace(/\n\s*/g, " "));
    assert.equal(written.length, values.length);
    for (const line of written) {
        assert(!line.includes("\n"), `A value was written on more than one line: ${line}`);
    }
    return written;
}

//
// The class a file exports under `name`.
//
export function exportedClass(exports: Record<string, unknown>, name: string): Function {
    assert(name.length > 0);
    const found: unknown = exports[name];
    assert(typeof found === "function", `The file exports no class ${name}.`);
    return found;
}

//
// The values an instance is built with so one of its methods can be called: each constructor
// parameter's baseline value.
//
export function constructorValues(shard: IOpenShard, className: string, context: IValueContext): unknown[] {
    const facts = shard.reading.facts;
    assert(facts !== undefined, `${shard.request.file} is a sim file, which has no classes to build.`);
    const owner: ClassInfo | undefined = facts.classes.find((classInfo) => classInfo.name === className);
    assert(owner !== undefined, `No class ${className} was read.`);
    return owner.parameters.map((parameter) => buildBaseline(context, parameter));
}

//
// Calls a method, reads a getter or sets a setter on `target`.
//
export function useMember(target: object, name: string, accessor: "none" | "get" | "set", values: unknown[]): unknown {
    if (accessor === "get") {
        assert.equal(values.length, 0, `The getter ${name} was given values.`);
        return Reflect.get(target, name);
    }
    if (accessor === "set") {
        assert.equal(values.length, 1, `The setter ${name} was not given one value.`);
        return Reflect.set(target, name, values[0]);
    }
    const method: unknown = Reflect.get(target, name);
    assert(typeof method === "function", `There is no method ${name}.`);
    return Reflect.apply(method, target, values);
}

//
// Something that can receive messages, as a child process's own `process` is.
//
export interface IMessageSource {
    //
    // Calls `listener` with every message that arrives.
    //
    on(event: "message", listener: (message: unknown) => void): void;
}

//
// Answers every request that arrives on `source` with `send`, one at a time and in order. A request
// the child cannot answer, or one sent while another waits, is a defect in Faultline, so `fail` is
// told and the child ends rather than answering wrongly.
//
export function serveChild(child: IChild, source: IMessageSource, send: (message: IReply) => void, fail: (error: unknown) => void): void {
    let queue = Promise.resolve();
    let waiting = 0;
    source.on("message", (message: unknown) => {
        if (waiting < requestsWaitingMost) {
            waiting += 1;
            queue = queue.then(() => answerRequest(child, message, send)).catch(fail).finally(() => {
                waiting -= 1;
            });
        }
        else {
            fail(new Error(`The worker sent a request while ${waiting} waited for a reply. It sends each request only after the reply to the one before, so the worker and the child disagree about what was sent.`));
        }
    });
}

//
// Answers one request.
//
export async function answerRequest(child: IChild, message: unknown, send: (message: IReply) => void): Promise<void> {
    assert(typeof message === "object", "The child was sent something that is not a request.");
    assert(message !== null, "The child was sent something that is not a request.");
    if (isOpenRequest(message)) {
        const opened: IOpenedReply = {
            kind: "opened",
            shard: await child.open(message),
        };
        send(opened);
        return;
    }
    assert("kind" in message, "The child was sent something that is not a request.");
    if (message.kind === "read") {
        const read: IReadReply = {
            kind: "read",
            exercised: await child.read(),
        };
        send(read);
        return;
    }
    assert.equal(message.kind, "call", "The child was sent a request it does not know.");
    assert("token" in message, "The child was sent a call with no token.");
    assert(typeof message.token === "string", "The child was sent a call whose token is not text.");
    assert("read" in message, "The child was sent a call that does not say whether to read coverage.");
    assert(typeof message.read === "boolean", "The child was sent a call whose read is not true or false.");
    const called: ICalledReply = {
        kind: "called",
        result: await child.call(message.token, message.read),
    };
    send(called);
}

//
// Whether a message from the worker is a request to open a shard. The worker writes it from
// `IOpenRequest`. Every field is checked because a request read wrongly would be answered wrongly
// rather than failing.
//
export function isOpenRequest(message: object): message is IOpenRequest {
    if (!("kind" in message)) {
        return false;
    }
    if (message.kind !== "open") {
        return false;
    }
    if (!("file" in message)) {
        return false;
    }
    if (typeof message.file !== "string") {
        return false;
    }
    if (!("sims" in message)) {
        return false;
    }
    if (!Array.isArray(message.sims)) {
        return false;
    }
    if (!message.sims.every((sim: unknown) => typeof sim === "string")) {
        return false;
    }
    if (!("seed" in message)) {
        return false;
    }
    return typeof message.seed === "number";
}

//
// Whether what the child was started with, read from JSON, is its settings. The worker writes them
// from `IChildSettings`. Every field is checked because the child trusts them for every call.
//
export function isChildSettings(read: unknown): read is IChildSettings {
    if (typeof read !== "object") {
        return false;
    }
    if (read === null) {
        return false;
    }
    if (!("projectRoot" in read)) {
        return false;
    }
    if (typeof read.projectRoot !== "string") {
        return false;
    }
    if (!("toolModules" in read)) {
        return false;
    }
    if (typeof read.toolModules !== "string") {
        return false;
    }
    if (!("simTypes" in read)) {
        return false;
    }
    if (!Array.isArray(read.simTypes)) {
        return false;
    }
    if (!read.simTypes.every((file: unknown) => typeof file === "string")) {
        return false;
    }
    if (!("limits" in read)) {
        return false;
    }
    return isCallLimits(read.limits);
}
