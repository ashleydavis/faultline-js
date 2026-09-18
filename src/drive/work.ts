// The driving itself: loading the copies, building values, calling every function, running every
// scenario and checking every invariant.
//
// Nothing here touches Node. A run in Node and a run in a browser both load this and differ only in
// how they start it, how they load a module and how they read what V8 counted.

import type { ClassInfo, FunctionInfo, ParameterInfo } from "../discover/functions.ts";
import type { PathSite } from "../discover/paths.ts";
import { effectIn, failuresByEffect, pointName, type Point } from "../effects/injector.ts";
import { RunChecklist, RunSubject } from "../effects/subject.ts";
import type { FileModel, RunModel } from "../model.ts";
import { functionKey, type FromDriver, type Unit } from "./protocol.ts";
import { callsPerUnit } from "./units.ts";
import { CannotBuild, ValueMaker, type CallableFactory } from "./values.ts";

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
                out.push(maker.spoiled(maker.make(parameter.recipe)));
            }
            continue;
        }
        if (parameter.optional && maker.subject.rng.int(0, 1) === 0) {
            return out;
        }
        out.push(maker.spoiled(maker.make(parameter.recipe)));
    }
    return out;
}

// Calls one function once, and says whether the call went through.
async function callOnce(
    maker: ValueMaker,
    module: Record<string, unknown>,
    held: FunctionInfo,
    classes: ClassInfo[],
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
        if (answer instanceof Promise) {
            await answer;
        }
        return "called";
    }
    catch {
        // A function that throws on an input it was never written for is stepped over rather than
        // failing the run. Only a scenario says an answer was wrong.
        return "stepped";
    }
}

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
        try {
            const answer = check(subject);
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
    try {
        await callOnce(new ValueMaker(watching, factories), module, held, file.classes);
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
    const wanted = file.paths.filter((one) => one.fn === held.label && !runtime.ticked.has(`${one.file}:${one.name}`));

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
            subject.injector.explore(place, failure);
            try {
                const answer = await callOnce(new ValueMaker(subject, factories), module, held, file.classes);
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

// Whether every path the exploring is after has run. A runtime that cannot read what has run while
// it is still driving answers no, so every combination is tried.
async function allRan(runtime: Runtime, file: FileModel, wanted: PathSite[]): Promise<boolean> {
    if (runtime.reached === undefined) {
        return false;
    }
    const ran = await runtime.reached(file);
    return wanted.every((one) => ran.has(one.name));
}

// Runs one unit and says whether the run carries on. A scenario that says the answer is wrong
// stops it: the report is that one failure and the plan that reproduces it, and everything after
// would bury it.
export async function runUnit(runtime: Runtime, model: RunModel, unit: Unit, factories: CallableFactory[]): Promise<boolean> {
    const subject = new RunSubject(unit.seed, unit.faulting ? "faulting" : "clean");
    const maker = new ValueMaker(subject, factories);

    if (unit.kind === "scenario") {
        const scenario = model.scenarios[unit.scenario!]!;
        const module = await runtime.load(scenario.module);
        const run = module[scenario.exportName] as (...args: unknown[]) => unknown;
        try {
            const answer = run(subject, subject.injector, new RunChecklist(runtime.ticked));
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

    for (let round = 0; round < callsPerUnit; round += 1) {
        try {
            const answer = await callOnce(maker, module, held, file.classes);
            if (answer === "called") {
                calls += 1;
            }
            else {
                stepped += 1;
            }
        }
        catch (thrown) {
            if (thrown instanceof CannotBuild) {
                cannotBuild = { parameter: parameterNeeding(held, thrown), typeText: thrown.typeText };
                break;
            }
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
