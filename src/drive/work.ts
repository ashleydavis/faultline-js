// The driving itself: loading the copies, building values, calling every function, running every
// scenario and checking every invariant.
//
// Nothing here touches Node. A run in Node and a run in a browser both load this and differ only in
// how they start it, how they load a module and how they read what V8 counted.

import type { ClassInfo, FunctionInfo, ParameterInfo } from "../discover/functions.ts";
import type { PathSite } from "../discover/paths.ts";
import { runWith } from "../effects/current.ts";
import { effectIn, failuresByEffect, pointName, type Point } from "../effects/injector.ts";
import { RunChecklist, RunSubject } from "../effects/subject.ts";
import type { FileModel, RunModel } from "../model.ts";
import { functionKey, type FromDriver, type Unit } from "./protocol.ts";
import { callsPerUnit, mostCalls } from "./units.ts";
import { CannotBuild, standIn, ValueMaker, type CallableFactory } from "./values.ts";

// What a runtime has to supply for the driving to happen in it.
export interface Runtime {
    // Loads one copy, by the path the model names it under.
    load: (file: string) => Promise<Record<string, unknown>>;

    // Says one thing back to whatever started the run.
    say: (message: FromDriver) => void;

    // Reads what V8 has counted and sends it up, when enough has happened to be worth sending.
    sendCoverage: (force: boolean) => Promise<void>;

    // Which of one file's code paths have run so far, by the name of the path. A runtime that
    // cannot say while it is still driving leaves this out, and the exploring then tries every
    // combination rather than stopping at the one that finishes the function.
    reached?: (file: FileModel) => Promise<Set<string>>;

    // The path names earlier rounds reached, which a scenario reads off the checklist.
    ticked: Set<string>;
}

// Builds the factory table from the sim files.
export async function readFactories(runtime: Runtime, model: RunModel): Promise<CallableFactory[]> {
    const out: CallableFactory[] = [];
    const owners = new Map<string, unknown>();
    for (const factory of model.factories) {
        const where = model.simModules[factory.file];
        if (where === undefined) {
            continue;
        }
        const module = await runtime.load(where);
        const held = module[factory.exportName];
        if (held === undefined) {
            continue;
        }
        if (factory.method === undefined) {
            out.push({
                key: factory.key,
                parameters: factory.parameters,
                make: (maker) => (held as (...args: unknown[]) => unknown)(...argumentsFor(maker, factory.parameters)),
            });
            continue;
        }
        const ownerKey = `${factory.file}#${factory.exportName}`;
        const method = factory.method;
        out.push({
            key: factory.key,
            parameters: factory.parameters,
            make: (maker) => {
                let owner = owners.get(ownerKey);
                if (owner === undefined) {
                    const built = held as new (...args: unknown[]) => unknown;
                    owner = new built(...argumentsFor(maker, factory.ownerParameters ?? []));
                    owners.set(ownerKey, owner);
                }
                const on = owner as Record<string, (...args: unknown[]) => unknown>;
                return on[method]!(...argumentsFor(maker, factory.parameters));
            },
        });
    }
    return out;
}

// Builds the arguments for one call. An optional parameter is left out about half the time, so the
// code that fills in a default is reached as well as the code that uses what it was given.
function argumentsFor(maker: ValueMaker, parameters: ParameterInfo[]): unknown[] {
    const out: unknown[] = [];
    for (const parameter of parameters) {
        if (parameter.rest) {
            const count = maker.subject.rng.pick([0, 1, 2]);
            for (let index = 0; index < count; index += 1) {
                out.push(maker.spoiled(built(maker, parameter)));
            }
            continue;
        }
        if (parameter.optional && maker.subject.rng.int(0, 1) === 0) {
            return out;
        }
        out.push(maker.spoiled(built(maker, parameter)));
    }
    return out;
}

// One argument, or a stand-in for one the run cannot build.
//
// A type the run cannot build used to stop the unit, so a function taking one was never called and
// every path in it went unreached. It is called with a stand-in instead, which reaches the paths
// that do not turn on what is inside the argument. The run still asks for a test input factory,
// because the ones that do turn on it are still out of reach.
function built(maker: ValueMaker, parameter: ParameterInfo): unknown {
    try {
        return maker.make(parameter.recipe);
    }
    catch (thrown) {
        if (!(thrown instanceof CannotBuild)) {
            throw thrown;
        }
        maker.stoodIn.push(thrown);
        return standIn({ values: maker.tests, properties: maker.properties, at: maker.at, given: new Map() });
    }
}

// Calls one function once, and says whether the call went through.
//
// The run is put in flight for the whole of the call, so a file read or a fetch the code under test
// makes reaches this run's own tree and this run's own network however it got there.
async function callOnce(
    maker: ValueMaker,
    module: Record<string, unknown>,
    held: FunctionInfo,
    classes: ClassInfo[],
    siblings: FunctionInfo[] = [],
): Promise<"called" | "stepped"> {
    const before = runWith(maker.subject);
    try {
        return await callWhileRunning(maker, module, held, classes, siblings);
    }
    finally {
        runWith(before);
    }
}

// The call itself, with the run already in flight.
async function callWhileRunning(
    maker: ValueMaker,
    module: Record<string, unknown>,
    held: FunctionInfo,
    classes: ClassInfo[],
    siblings: FunctionInfo[] = [],
): Promise<"called" | "stepped"> {
    const reach = held.reach;
    let target: ((...args: unknown[]) => unknown) | undefined;
    if (reach.how === "export") {
        target = exportOf(module, reach.name) as ((...args: unknown[]) => unknown) | undefined;
    }
    if (reach.how === "method") {
        if (reach.classExport === "") {
            return "stepped";
        }
        const klass = exportOf(module, reach.classExport) as (new (...args: unknown[]) => unknown) | undefined;
        if (klass === undefined) {
            return "stepped";
        }
        if (reach.onClass) {
            const onClass = klass as unknown as Record<string, unknown>;
            if (reach.accessor !== "none") {
                return readOrWrite(maker, onClass, reach.accessor, reach.name, held);
            }
            target = onClass[reach.name] as ((...args: unknown[]) => unknown) | undefined;
        }
        else {
            const declared = classes.find((one) => one.name === reach.className);
            let instance: Record<string, unknown>;
            try {
                instance = new klass(...argumentsFor(maker, declared?.parameters ?? [])) as Record<string, unknown>;
            }
            catch {
                // A constructor that refuses what the run built is stepped over, the same as any
                // other call that throws on an input it was never written for.
                return "stepped";
            }
            usedFirst(maker, instance, held, siblings);
            if (reach.accessor !== "none") {
                return readOrWrite(maker, instance, reach.accessor, reach.name, held);
            }
            const method = instance[reach.name];
            if (typeof method !== "function") {
                return "stepped";
            }
            target = (method as (...args: unknown[]) => unknown).bind(instance);
        }
    }
    if (typeof target !== "function") {
        return "stepped";
    }
    const args = argumentsFor(maker, held.parameters);
    try {
        const answer = target(...args);
        await callWhatCameBack(maker, answer instanceof Promise ? await answer : answer);
        return "called";
    }
    catch {
        // A function that throws on an input it was never written for is stepped over rather than
        // failing the run. Only a scenario says an answer was wrong.
        return "stepped";
    }
}

// Uses an object before the method being measured is called on it.
//
// A method whose path turns on what the object already holds is reached by no call to a fresh one.
// A queue drained before anything was put in it never runs the body of its own loop, and it is the
// commonest thing a class has: a method that does something only once another has been called.
//
// The other methods of the class are called first, as many of them as the turn says, so one turn
// calls the method on a fresh object and later turns call it on one that has been used.
function usedFirst(maker: ValueMaker, instance: Record<string, unknown>, held: FunctionInfo, siblings: FunctionInfo[]): void {
    const others = siblings.filter((one) => one.label !== held.label && one.reach.how === "method" && !one.reach.onClass);
    for (let at = 0; at < maker.at % (others.length + 1); at += 1) {
        const other = others[at % others.length]!;
        const name = other.reach.how === "method" ? other.reach.name : "";
        const method = instance[name];
        if (typeof method !== "function") {
            continue;
        }
        try {
            const answer = (method as (...args: unknown[]) => unknown).call(instance, ...argumentsFor(maker, other.parameters));
            if (answer instanceof Promise) {
                answer.catch(() => undefined);
            }
        }
        catch {
            // A method that refuses what the run built leaves the object as it was, and the method
            // being measured is still called on it.
        }
    }
}

// How far into what a call handed back the run goes looking for more to call. One step reaches a
// function a call returned and the methods of an object it returned, and a second would be walking
// a whole graph for what it might hold.
const deepestAnswer = 1;

// Calls what a call handed back, when what it handed back is something to call.
//
// A function written inside another function is reached no other way. It reads what the function
// around it had, so no export gets at it and the only call it ever takes is the one the function
// around it hands out. A run that threw the answer away never reached a line of it.
async function callWhatCameBack(maker: ValueMaker, answer: unknown, depth = 0): Promise<void> {
    if (depth > deepestAnswer) {
        return;
    }
    if (typeof answer === "function") {
        try {
            const held = (answer as (...args: unknown[]) => unknown)(...madeUpFor(maker, answer.length));
            if (held instanceof Promise) {
                await held;
            }
        }
        catch {
            // The same as any other call that throws on an input it was never written for.
        }
        return;
    }
    if (answer === null || typeof answer !== "object" || Array.isArray(answer)) {
        return;
    }
    for (const held of Object.values(answer as Record<string, unknown>)) {
        if (typeof held === "function") {
            await callWhatCameBack(maker, held, depth + 1);
        }
    }
}

// Arguments for a function the run only knows the arity of. There is no declaration to read a type
// off, so each one is a value worth trying and the turns work through the lists as they do
// everywhere else.
function madeUpFor(maker: ValueMaker, arity: number): unknown[] {
    const out: unknown[] = [];
    for (let at = 0; at < Math.min(arity, mostArguments); at += 1) {
        out.push(maker.make({ kind: "any" }));
    }
    return out;
}

// How many arguments the run makes up for a function it has no declaration for. A function taking
// more than eight is rare, and one declaring a hundred would cost a hundred values per call.
const mostArguments = 8;

// What a module hands out under one name. A name with a dot in it is a declaration the file kept to
// itself, which the copy hands out on one holder rather than as an export of its own.
function exportOf(module: Record<string, unknown>, name: string): unknown {
    const dot = name.indexOf(".");
    if (dot < 0) {
        return module[name];
    }
    const holder = module[name.slice(0, dot)] as Record<string, unknown> | undefined;
    return holder?.[name.slice(dot + 1)];
}

// Checks every invariant against the subject the unit just ran with, and says whether the run
// carries on. An invariant that throws stops the run the same way a scenario that throws does.
async function invariantsHold(runtime: Runtime, model: RunModel, unit: Unit, subject: RunSubject): Promise<boolean> {
    for (const invariant of model.invariants) {
        const module = await runtime.load(invariant.module);
        const check = module[invariant.exportName] as (...args: unknown[]) => unknown;
        const before = runWith(subject);
        try {
            const answer = check();
            if (answer instanceof Promise) {
                await answer;
            }
        }
        catch (thrown) {
            runtime.say({
                type: "failed",
                seed: unit.seed,
                where: `${invariant.file}:${invariant.line} ${invariant.exportName}`,
                error: describe(thrown),
                kind: "invariant",
            });
            return false;
        }
        finally {
            runWith(before);
        }
    }
    return true;
}

// Calls one function once to see where its effects could fail, then once more for every one of
// those places and every way that effect goes wrong.
//
// A draw reaches the places it happens to land on. This reaches all of them, so the handler for a
// failure on the third read is found as surely as the one for a failure on the first.
//
// It stops as soon as every code path in the function has run. A function with six places an effect
// can fail costs thirty calls to try every combination, and the run usually only needs the first
// few of them.
async function explore(
    runtime: Runtime,
    model: RunModel,
    unit: Unit,
    factories: CallableFactory[],
    file: FileModel,
    held: FunctionInfo,
    module: Record<string, unknown>,
): Promise<boolean> {
    let calls = 0;
    let stepped = 0;

    const watching = new RunSubject(unit.seed, "recording", model.work);
    watching.files.holds(file.properties, file.tests);
    try {
        await callOnce(new ValueMaker(watching, factories, 0, file), module, held, file.classes, file.functions);
        calls += 1;
    }
    catch {
        stepped += 1;
    }

    // Every place found so far. It grows as the exploring goes: failing one place sends the code
    // down a branch the clean call never took, and the places on that branch are found no other
    // way.
    const places: string[] = [];
    addPlaces(places, watching.injector.recorded);

    // The paths of this function an earlier round has yet to reach. They are what the exploring is
    // for, so reaching all of them is what finishes it.
    const wanted = stillWanted(runtime, file, held);

    combinations: for (let at = 0; at < places.length; at += 1) {
        const place = places[at]!;
        const effect = effectIn(place);
        if (effect === undefined) {
            continue;
        }
        for (const failure of failuresByEffect[effect]) {
            if (await allRan(runtime, file, wanted)) {
                break combinations;
            }
            const subject = new RunSubject(unit.seed, "exploring", model.work);
            subject.files.holds(file.properties, file.tests, at);
            subject.injector.explore(place, failure);
            try {
                const answer = await callOnce(new ValueMaker(subject, factories, at, file), module, held, file.classes, file.functions);
                if (answer === "called") {
                    calls += 1;
                }
                else {
                    stepped += 1;
                }
            }
            catch {
                stepped += 1;
            }
            addPlaces(places, subject.injector.recorded);
        }
    }

    const stillHolds = await invariantsHold(runtime, model, unit, watching);
    runtime.say({ type: "unit", index: unit.index, calls, stepped, fn: functionKey(file.file, held.label) });
    await runtime.sendCoverage(false);
    return stillHolds;
}

// Puts the places one call reached on the end of the list, leaving out the ones already there.
//
// The first turn at each site comes before the second turn at any of them. A loop that reads ten
// files is ten turns at one site, and taking them in the order they happened would work through the
// whole loop before any site after it was tried.
function addPlaces(places: string[], recorded: Point[]): void {
    const held = new Set(places);
    const found = recorded
        .map((point, order) => ({ name: pointName(point), occurrence: point.occurrence, order }))
        .filter((one) => !held.has(one.name))
        .filter((one, at, all) => all.findIndex((other) => other.name === one.name) === at)
        .sort((left, right) => left.occurrence - right.occurrence || left.order - right.order);
    for (const one of found) {
        places.push(one.name);
    }
}

// Says what a file the run was never told about holds, built from what the file being measured
// reads off its values. Code that parses a settings file and reads a field off it finds that field.
function tellTheFiles(subject: RunSubject, model: RunModel, unit: Unit): void {
    const file = unit.file === undefined ? undefined : model.files[unit.file];
    if (file !== undefined) {
        subject.files.holds(file.properties, file.tests);
    }
}

// The paths one unit is after: this function's, and those of every function written inside it,
// less the ones an earlier round already reached.
//
// A function written inside another is run by the call to the one around it, so its paths are what
// say whether that unit still has something to try. Counting only the outer function's paths stops
// a unit the moment the outer function is covered, and the inner one is left with whatever the
// first turn happened to reach.
function stillWanted(runtime: Runtime, file: FileModel, held: FunctionInfo): PathSite[] {
    const mine = new Set([held.label]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const one of file.functions) {
            if (one.within !== undefined && mine.has(one.within) && !mine.has(one.label)) {
                mine.add(one.label);
                grew = true;
            }
        }
    }
    return file.paths.filter((one) => mine.has(one.fn) && !runtime.ticked.has(`${one.file}:${one.name}`));
}

// Whether every path the exploring is after has run. A runtime that cannot read what has run while
// it is still driving answers no, so every combination is tried.
async function allRan(runtime: Runtime, file: FileModel, wanted: PathSite[]): Promise<boolean> {
    return (await stillToRun(runtime, file, wanted)) === 0;
}

// How many of the paths a unit is after have still to run. A runtime that cannot read what has run
// while it is still driving answers that they all have, so every combination is tried.
async function stillToRun(runtime: Runtime, file: FileModel, wanted: PathSite[]): Promise<number> {
    if (runtime.reached === undefined || wanted.length === 0) {
        return wanted.length;
    }
    const ran = await runtime.reached(file);
    return wanted.filter((one) => !ran.has(one.name)).length;
}

// Runs one unit and says whether the run carries on. A scenario that says the answer is wrong
// stops it: the report is that one failure and the plan that reproduces it, and everything after
// would bury it.
export async function runUnit(runtime: Runtime, model: RunModel, unit: Unit, factories: CallableFactory[]): Promise<boolean> {
    const subject = new RunSubject(unit.seed, unit.faulting ? "faulting" : "clean");
    tellTheFiles(subject, model, unit);

    if (unit.kind === "scenario") {
        const scenario = model.scenarios[unit.scenario!]!;
        const module = await runtime.load(scenario.module);
        const run = module[scenario.exportName] as (...args: unknown[]) => unknown;
        const before = runWith(subject);
        try {
            const answer = run(subject.injector, new RunChecklist(runtime.ticked));
            if (answer instanceof Promise) {
                await answer;
            }
        }
        catch (thrown) {
            runtime.say({
                type: "failed",
                seed: unit.seed,
                where: `${scenario.file}:${scenario.line} ${scenario.exportName}`,
                error: describe(thrown),
                kind: "scenario",
            });
            runtime.say({ type: "unit", index: unit.index, calls: 1, stepped: 0 });
            await runtime.sendCoverage(true);
            return false;
        }
        finally {
            runWith(before);
        }
        const held = await invariantsHold(runtime, model, unit, subject);
        runtime.say({ type: "unit", index: unit.index, calls: 1, stepped: 0 });
        await runtime.sendCoverage(false);
        return held;
    }

    const file = model.files[unit.file!]!;
    const held = file.functions[unit.fn!]!;
    const module = await runtime.load(file.module);

    if (unit.kind === "explore") {
        return await explore(runtime, model, unit, factories, file, held, module);
    }

    let calls = 0;
    let stepped = 0;
    let cannotBuild: { parameter: string; typeText: string } | undefined;

    // Every path of this function that is still to be reached. Once they have all run there is no
    // reason to keep trying values.
    const wanted = stillWanted(runtime, file, held);

    // How many turns in a row may reach no path the unit did not already have before it stops.
    //
    // A unit stops when every path has run. One whose paths cannot all be reached would otherwise
    // run to the cap for every function of every seed, so it stops when it stops making progress
    // instead, and a turn per entry of the longest list of values is long enough to be sure the
    // progress has really stopped.
    const patience = callsPerUnit;
    let reached = 0;
    let quiet = 0;

    for (let round = 0; round < mostCalls; round += 1) {
        if (round > 0) {
            const ran = await stillToRun(runtime, file, wanted);
            if (ran === 0) {
                break;
            }
            if (wanted.length - ran > reached) {
                reached = wanted.length - ran;
                quiet = 0;
            }
            else {
                quiet += 1;
                if (quiet >= patience) {
                    break;
                }
            }
        }
        try {
            subject.files.holds(file.properties, file.tests, round);
            const maker = new ValueMaker(subject, factories, round, file);
            const answer = await callOnce(maker, module, held, file.classes, file.functions);
            const missing = maker.stoodIn[0];
            if (cannotBuild === undefined && missing !== undefined) {
                cannotBuild = { parameter: parameterNeeding(held, missing), typeText: missing.typeText };
            }
            if (answer === "called") {
                calls += 1;
            }
            else {
                stepped += 1;
            }
        }
        catch {
            stepped += 1;
        }
    }

    const stillHolds = await invariantsHold(runtime, model, unit, subject);
    runtime.say({ type: "unit", index: unit.index, calls, stepped, fn: functionKey(file.file, held.label), cannotBuild });
    await runtime.sendCoverage(false);
    return stillHolds;
}

// Runs a getter or a setter, which is reached by reading or writing the property rather than by
// calling it.
function readOrWrite(
    maker: ValueMaker,
    on: Record<string, unknown>,
    accessor: "get" | "set",
    name: string,
    held: FunctionInfo,
): "called" | "stepped" {
    try {
        if (accessor === "get") {
            void on[name];
            return "called";
        }
        on[name] = maker.make(held.parameters[0]?.recipe ?? { kind: "any" });
        return "called";
    }
    catch (thrown) {
        if (thrown instanceof CannotBuild) {
            throw thrown;
        }
        return "stepped";
    }
}

// Which parameter it was that could not be built, so the line asking for a factory names it.
function parameterNeeding(held: FunctionInfo, thrown: CannotBuild): string {
    for (const parameter of held.parameters) {
        if (recipeMentions(parameter.recipe, thrown.typeText)) {
            return parameter.name;
        }
    }
    return held.parameters[0]?.name ?? "";
}

// Whether a recipe is the one that raised, read by the name the checker gave the type.
function recipeMentions(recipe: unknown, typeText: string): boolean {
    return JSON.stringify(recipe).includes(JSON.stringify(typeText));
}

// One thrown value written out, whatever it was.
export function describe(thrown: unknown): string {
    if (thrown instanceof Error) {
        return `${thrown.name}: ${thrown.message}`;
    }
    return String(thrown);
}
