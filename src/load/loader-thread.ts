//
// The module the child registers with `module.register`, which Node loads on its loader thread and
// asks to resolve and load every module the child imports after that. It builds the real file
// system and the loader once, when Node starts it with the run's settings, and hands every request
// to the hooks in `hooks.ts`, so the decisions sit where a test can call them with a file system in
// memory.
//

import assert from "node:assert/strict";
import type module from "node:module";
import { FileSystem } from "../lib/file-system.ts";
import { createLoader, loadModule, resolveModule } from "./hooks.ts";
import type { ILoader, ILoadSettings, NextLoad, NextResolve } from "./hooks.ts";

//
// The loader every request on this thread goes through, once `initialize` has built it. Node gives
// a hooks module no way to hand state from `initialize` to `resolve` and `load` but the module's
// own scope: it calls the hooks with its own arguments only, so no argument can carry the loader,
// and the loader is held here.
//
const startedLoaders: ILoader[] = [];

//
// Builds the loader for the run Node was started for.
//
export function initialize(settings: ILoadSettings): void {
    assert.equal(startedLoaders.length, 0, "The loader thread was started twice.");
    startedLoaders.push(createLoader(settings, new FileSystem()));
    assert.equal(startedLoaders.length, 1);
}

//
// The one loader `initialize` built, out of the loaders started on this thread.
//
export function loaderOf(loaders: ILoader[]): ILoader {
    assert.equal(loaders.length, 1, "The loader thread was asked to load a module before it was started.");
    const loader = loaders[0];
    assert(loader);
    return loader;
}

//
// Where an import leads, as `resolveModule` decides.
//
export function resolve(specifier: string, context: module.ResolveHookContext, nextResolve: NextResolve): Promise<module.ResolveFnOutput> {
    assert(specifier.length > 0);
    assert(typeof nextResolve === "function");
    return resolveModule(loaderOf(startedLoaders), specifier, context, nextResolve);
}

//
// The source Node runs for a module, as `loadModule` decides.
//
export function load(url: string, context: module.LoadHookContext, nextLoad: NextLoad): Promise<module.LoadFnOutput> {
    assert(url.length > 0);
    assert(typeof nextLoad === "function");
    return loadModule(loaderOf(startedLoaders), url, context, nextLoad);
}
