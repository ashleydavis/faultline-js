//
// Module hooks that run on the child's own thread and answer, from memory, the questions the
// loader thread has already answered once.
//
// Every call loads its own copy of every project module, so Node asks the hooks to resolve every
// import and load every project file again for every call. The hooks that do the work run on a
// loader thread of their own, and each question is a round trip to that thread that the child's
// main thread waits for. On 2026-10-26 a CPU profile of a child showed it waiting on those round
// trips for over half of its time, while the loader thread was idle for most of it. The project's
// files do not change during a run, so each answer is the same for every copy apart from the copy
// number in its URL: these hooks ask the loader thread once and give every later copy the kept
// answer with its own number. They read no file, so they need no synchronous file call.
//
// They also send an import or `require` of a built-in module, written outside Faultline's own
// modules, to the simulated module that stands in for it. A `require` never reaches the loader
// thread's hooks, so without this a package that requires `http` would get the real one.
//

import assert from "node:assert/strict";
import type module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { copyNumberOf, fileOf, isInside, numberedUrl } from "./hooks.ts";

//
// The hook Node calls after an in-thread resolve hook to resolve an import the next way, which is
// the loader thread's hooks.
//
export type NextSyncResolve = (specifier: string, context?: Partial<module.ResolveHookContext>) => module.ResolveFnOutput;

//
// The hook Node calls after an in-thread load hook to load a module the next way, which is the
// loader thread's hooks.
//
export type NextSyncLoad = (url: string, context?: Partial<module.LoadHookContext>) => module.LoadFnOutput;

//
// One kept answer to a resolve.
//
export interface IKeptResolution {
    //
    // The answer the loader thread gave.
    //
    answer: module.ResolveFnOutput;

    //
    // The project file the answer leads to when it is a copy, which each later importer gets
    // under its own copy number, or undefined when the answer is the same for every importer.
    //
    copyOf: string | undefined;
}

//
// The answers kept for the life of the child.
//
export interface IKeptAnswers {
    //
    // Each resolve's answer, by `resolutionKey`.
    //
    resolveAnswers: Map<string, IKeptResolution>;

    //
    // The source of each project file a copy was loaded from, by its absolute path.
    //
    loadAnswers: Map<string, module.LoadFnOutput>;

    //
    // The simulated module that stands in for each built-in module, by the name it is asked for.
    // A `require` is resolved by these hooks and Node's own resolver alone, never by the loader
    // thread's hooks, so a package that requires `http` would get the real one if these hooks did
    // not send it to the simulated one themselves.
    //
    simulated: Map<string, string>;

    //
    // The directory Faultline's own modules sit in. An import or `require` written there is the
    // tool's, and gets the real built-in modules.
    //
    toolModules: string;
}

//
// Makes an empty set of kept answers, which sends the built-in modules named in `simulated` to
// their simulated ones for every importer outside `toolModules`.
//
export function createKeptAnswers(simulated: Map<string, string>, toolModules: string): IKeptAnswers {
    assert(path.isAbsolute(toolModules));
    const kept: IKeptAnswers = {
        resolveAnswers: new Map(),
        loadAnswers: new Map(),
        simulated,
        toolModules,
    };
    assert.equal(kept.resolveAnswers.size, 0);
    assert.equal(kept.loadAnswers.size, 0);
    return kept;
}

//
// What a resolve's answer depends on: whether the importer is a copy, the importer's file, the
// conditions it imports under and the specifier. The copy number itself is left out, because the
// answer is the same for every copy apart from the number, and `keptResolve` puts the number in.
// A specifier that is a `file:` URL, as the child imports each call's copy by, is kept without its
// query, because it names the call's copy and resolves to itself. Undefined when the importer is
// not a file, whose answer is left to the loader thread every time.
//
export function resolutionKey(specifier: string, context: module.ResolveHookContext): string | undefined {
    assert(specifier.length > 0);
    assert(Array.isArray(context.conditions));
    const importer = fileOf(context.parentURL);
    if (!importer) {
        return undefined;
    }
    const isCopy = copyNumberOf(context.parentURL) !== undefined;
    const named = specifier.startsWith("file:") ? specifier.split("?")[0]! : specifier;
    const key = [isCopy ? "copy" : "file", importer, context.conditions.join(","), named].join("\0");
    assert(key.includes(importer));
    return key;
}

//
// Resolves an import from the kept answers, asking the loader thread through `next` the first time
// each import is met.
//
export function keptResolve(kept: IKeptAnswers, specifier: string, context: module.ResolveHookContext, next: NextSyncResolve): module.ResolveFnOutput {
    const simulatedFile = kept.simulated.get(specifier);
    if (simulatedFile) {
        const importer = fileOf(context.parentURL);
        if (!importer || !isInside(kept.toolModules, importer)) {
            return {
                url: pathToFileURL(simulatedFile).href,
                shortCircuit: true,
            };
        }
    }
    const key = resolutionKey(specifier, context);
    if (!key) {
        return next(specifier, context);
    }
    const found = kept.resolveAnswers.get(key);
    if (found) {
        if (specifier.startsWith("file:")) {
            return {
                ...found.answer,
                url: specifier,
                shortCircuit: true,
            };
        }
        if (!found.copyOf) {
            return {
                ...found.answer,
                shortCircuit: true,
            };
        }
        return {
            ...found.answer,
            url: numberedUrl(found.copyOf, copyNumberOf(context.parentURL)),
            shortCircuit: true,
        };
    }
    const answer = next(specifier, context);
    assert(answer.url.length > 0);
    if (specifier.startsWith("file:")) {
        if (answer.url !== specifier) {
            //
            // A URL that led somewhere else than itself depends on more than the URL, so it is
            // asked of the loader thread every time.
            //
            return answer;
        }
    }
    let copyOf: string | undefined;
    if (copyNumberOf(answer.url) !== undefined) {
        copyOf = fileOf(answer.url);
    }
    kept.resolveAnswers.set(key, {
        answer,
        copyOf,
    });
    return answer;
}

//
// Loads a copy of a project file from the kept source, asking the loader thread through `next`
// the first time each file is loaded. A URL that is no copy is loaded once by Node anyway, so it
// is left to the loader thread.
//
export function keptLoad(kept: IKeptAnswers, url: string, context: module.LoadHookContext, next: NextSyncLoad): module.LoadFnOutput {
    assert(url.length > 0);
    if (copyNumberOf(url) === undefined) {
        return next(url, context);
    }
    const file = fileOf(url);
    assert(file !== undefined, `${url} is a copy that is not a file.`);
    const found = kept.loadAnswers.get(file);
    if (found) {
        return {
            ...found,
            shortCircuit: true,
        };
    }
    const answer = next(url, context);
    assert(answer.source !== undefined, `The loader thread loaded ${url} with no source.`);
    kept.loadAnswers.set(file, answer);
    return answer;
}

//
// Registers the in-thread hooks over `kept` with `registerHooks`, which is Node's
// `module.registerHooks` in the child and a stand-in in a test.
//
export function registerKeptHooks(kept: IKeptAnswers, registerHooks: (options: module.RegisterHooksOptions) => module.ModuleHooks): module.ModuleHooks {
    assert.equal(typeof registerHooks, "function");
    const hooks = registerHooks({
        resolve: (specifier: string, context: module.ResolveHookContext, next: NextSyncResolve): module.ResolveFnOutput => keptResolve(kept, specifier, context, next),
        load: (url: string, context: module.LoadHookContext, next: NextSyncLoad): module.LoadFnOutput => keptLoad(kept, url, context, next),
    });
    assert(hooks !== undefined);
    return hooks;
}
