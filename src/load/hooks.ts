//
// Loads the project into the child process that fault tests it, through Node's module hooks.
//
// The hooks run on Node's loader thread, registered with `module.register` by the child. No file
// is written to disk: a TypeScript file is transpiled in memory as it is imported, an
// import is resolved the way the project's own `tsconfig.json` resolves it and every import of a
// built-in module Faultline simulates, from the project or from a package it uses, gets the
// simulated one. Every hook is asynchronous and reads files without blocking.
//
// Every project file an import leads to carries the number of the call it is loaded for in the
// query of its URL, taken from the URL of the file that imports it, so each call gets copies of the
// project's modules of its own and sees no state an earlier call left in them. Packages under
// `node_modules` are shared between calls.
//

import assert from "node:assert/strict";
import type module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { moduleResolutionHost, readCompilerOptions, ownerConfig } from "../discover/program.ts";
import type { IFileSystem } from "../lib/file-system.ts";
import { createReading, untilKnown } from "../lib/known-files.ts";
import type { IReading } from "../lib/known-files.ts";
import { effectModuleFor } from "../world/effects/index.ts";
import { checkEntryPoint } from "./entry-check.ts";
import { exportEverything } from "./export-everything.ts";

//
// What the hooks need to know about the run. It crosses to the loader thread as data, so it holds
// only plain values.
//
export interface ILoadSettings {
    //
    // The absolute path of the project being fault tested.
    //
    projectRoot: string;

    //
    // The absolute path of the directory Faultline's own modules sit in: `src` in a clone and
    // `dist` in an installed copy. A module in here is the tool, so it gets the real built-in
    // modules, and the simulated ones sit under it in `world/effects`.
    //
    toolModules: string;
}

//
// The hooks and what they keep between one import and the next.
//
export interface ILoader {
    //
    // What the run said about itself.
    //
    settings: ILoadSettings;

    //
    // Where every file is read from and what the compiler has had read for it so far.
    //
    reading: IReading;

    //
    // What each project file was transpiled to, by its absolute path. Every call loads its own copy
    // of a file, and the file has not changed in between, so it is transpiled once.
    //
    transpiled: Map<string, string>;

    //
    // The compiler options each `tsconfig.json` gives, by its path, or by the empty string for the
    // files no `tsconfig.json` in the project owns. A project has few configs and many files, so
    // each config is read once.
    //
    options: Map<string, ts.CompilerOptions>;

    //
    // The `type` each `package.json` gives, by its path, read once for the same reason.
    //
    packageTypes: Map<string, string>;

    //
    // The simulated module each specifier names, or undefined for one that names none, by the
    // specifier. Every call loads its own copy of every project file, so the same built-in module
    // is asked for once per import per call, and the answer never changes during a run.
    //
    simulatedModules: Map<string, string | undefined>;

    //
    // The project file each import leads to, or undefined for one that leads outside the project,
    // by the importing file and the specifier. Every call loads its own copy of every project file
    // and resolves every import again, and with the compiler that took about a millisecond each:
    // on 2026-10-26 one call of a file with 70 project modules resolved 276 imports. The project's
    // files do not change during a run, so each import is resolved once.
    //
    resolutions: Map<string, string | undefined>;
}

//
// The module format a transpiled file is handed to Node in.
//
export type ModuleFormat = "module" | "commonjs";

//
// The name of the query parameter a copy of a project file carries its call's number in. It is the
// command's own name, so a URL in a stack trace shows which tool put the query there.
//
export const copyParameter = "flt";

//
// The hook Node calls after the resolve hook to resolve an import its own way. Node's type writes
// it inline, so it is named here for the hooks and their callers to share.
//
export type NextResolve = (specifier: string, context: Partial<module.ResolveHookContext>) => module.ResolveFnOutput | Promise<module.ResolveFnOutput>;

//
// The hook Node calls after the load hook to load a module its own way, named for the same reason.
//
export type NextLoad = (url: string, context: Partial<module.LoadHookContext>) => module.LoadFnOutput | Promise<module.LoadFnOutput>;

//
// The extensions of the files a bundler imports for what they are rather than what they run:
// stylesheets, images, fonts and media. Node cannot load any of them, and the code under test
// gets nothing from one but a name to pass on, so each loads as a module with nothing in it.
//
const assetExtensions = new Set([
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".styl",
    ".svg",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".avif",
    ".ico",
    ".bmp",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".eot",
    ".mp3",
    ".mp4",
    ".webm",
    ".wav",
    ".ogg",
]);

//
// The extensions of the files Faultline transpiles: every kind of TypeScript and JavaScript a
// project can write, because a JavaScript file gets its private declarations exported too.
//
const scriptExtensions = new Set([
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
]);

//
// Makes the hooks for one run, reading through `fileSystem`, with nothing read yet.
//
export function createLoader(settings: ILoadSettings, fileSystem: IFileSystem): ILoader {
    assert(path.isAbsolute(settings.projectRoot));
    assert(path.isAbsolute(settings.toolModules));
    return {
        settings,
        reading: createReading(fileSystem),
        transpiled: new Map(),
        options: new Map(),
        packageTypes: new Map(),
        simulatedModules: new Map(),
        resolutions: new Map(),
    };
}

//
// The number of the call a URL's copy belongs to, or undefined for a URL that is no copy.
//
export function copyNumberOf(url: string | undefined): number | undefined {
    if (!url) {
        return undefined;
    }
    if (!url.startsWith("file:")) {
        return undefined;
    }
    const written = new URL(url).searchParams.get(copyParameter);
    if (written === null) {
        return undefined;
    }
    assert(written.length > 0, `${url} names a copy without its number.`);
    const copyNumber = Number(written);
    assert(Number.isInteger(copyNumber), `${url} names a copy that is not a whole number.`);
    assert(copyNumber >= 0);
    return copyNumber;
}

//
// The URL of a project file: the copy that belongs to the call numbered `copyNumber`, or the file
// itself when the importer is no copy. Node keeps one module per URL, so a new number gives a new
// copy of the file.
//
export function numberedUrl(file: string, copyNumber: number | undefined): string {
    assert(path.isAbsolute(file));
    const url = pathToFileURL(file).href;
    if (copyNumber === undefined) {
        return url;
    }
    assert(Number.isInteger(copyNumber));
    assert(copyNumber >= 0);
    return `${url}?${copyParameter}=${copyNumber}`;
}

//
// Where an import leads. A built-in module Faultline simulates leads to the simulated one for any
// importer but the tool itself. An import written in a project file is resolved by TypeScript with
// that file's compiler options, so `paths`, `baseUrl`, extensionless imports and a `.js` that names
// a `.ts` all lead where the project's own build sends them, to the copy of the importer's call.
// Anything else is left to Node.
//
export async function resolveModule(
    loader: ILoader,
    specifier: string,
    context: module.ResolveHookContext,
    nextResolve: NextResolve,
): Promise<module.ResolveFnOutput> {
    assert(specifier.length > 0);
    assert(Array.isArray(context.conditions));
    const importer = fileOf(context.parentURL);
    if (importer) {
        if (isInside(loader.settings.toolModules, importer)) {
            return nextResolve(specifier, context);
        }
    }
    const simulated = await simulatedModule(loader, specifier);
    if (simulated) {
        assert(path.isAbsolute(simulated));
        return {
            url: pathToFileURL(simulated).href,
            shortCircuit: true,
        };
    }
    if (importer) {
        if (isProjectFile(loader.settings, importer)) {
            const resolved = await keptResolution(loader, specifier, importer);
            if (resolved) {
                return withJsonType({
                    url: numberedUrl(resolved, copyNumberOf(context.parentURL)),
                    shortCircuit: true,
                }, context);
            }
            return withJsonType(await resolveAsBundler(loader, specifier, importer, context, nextResolve), context);
        }
    }
    return nextResolve(specifier, context);
}

//
// The extensions a bundler tries, in the order it tries them, when an import of a package's file
// names no extension and Node finds no file of that name. Bun and esbuild both try these.
//
const bundlerExtensions = [
    ".js",
    ".mjs",
    ".cjs",
    "/index.js",
];

//
// Where Node sends an import written in a project file that TypeScript leaves to Node, such as a
// package's file. A project built for a bundler can import a package's file without its extension
// (`dayjs/plugin/timezone`), which its bundler and Bun find and Node does not, so when Node finds
// no such module and the project's options say bundler resolution, the extensions a bundler tries
// are tried in turn. When none of them is found, Node is asked once more, so its own error names
// the import as it is written.
//
export async function resolveAsBundler(
    loader: ILoader,
    specifier: string,
    importer: string,
    context: module.ResolveHookContext,
    nextResolve: NextResolve,
): Promise<module.ResolveFnOutput> {
    assert(specifier.length > 0);
    assert(isProjectFile(loader.settings, importer));
    const options = await compilerOptions(loader, importer);
    if (options.moduleResolution !== ts.ModuleResolutionKind.Bundler) {
        return nextResolve(specifier, context);
    }
    const found = await findByNode(specifier, context, nextResolve);
    if (found) {
        return found;
    }
    for (const extension of bundlerExtensions) {
        const withExtension = await findByNode(`${specifier}${extension}`, context, nextResolve);
        if (withExtension) {
            return withExtension;
        }
    }
    return nextResolve(specifier, context);
}

//
// Node's answer for `specifier`, or undefined when Node finds no such module. Node reports a module
// it cannot find by throwing an error coded `ERR_MODULE_NOT_FOUND`, which is the one error turned
// into an answer here; every other error says something else is wrong and goes to the caller as
// Node raised it.
//
export async function findByNode(specifier: string, context: module.ResolveHookContext, nextResolve: NextResolve): Promise<module.ResolveFnOutput | undefined> {
    assert(specifier.length > 0);
    assert(Array.isArray(context.conditions));
    try {
        const answer = await nextResolve(specifier, context);
        assert(answer.url.length > 0);
        return answer;
    }
    catch (error: unknown) {
        if (codeOfError(error) === "ERR_MODULE_NOT_FOUND") {
            return undefined;
        }
        return Promise.reject(error);
    }
}

//
// The `code` a thrown error carries, or undefined for one that carries none.
//
export function codeOfError(error: unknown): unknown {
    if (typeof error !== "object") {
        return undefined;
    }
    if (!error) {
        return undefined;
    }
    if (!("code" in error)) {
        return undefined;
    }
    return error.code;
}

//
// An answer to a resolve with the import attribute a JSON module needs. Bun and bundlers import a
// JSON file without `with { type: "json" }` and Node refuses one that lacks it, so an import a
// project file writes that leads to a JSON file is given the attribute.
//
export function withJsonType(answer: module.ResolveFnOutput, context: module.ResolveHookContext): module.ResolveFnOutput {
    assert(answer.url.length > 0);
    if (!new URL(answer.url, "file:///").pathname.endsWith(".json")) {
        return answer;
    }
    if (context.importAttributes.type) {
        return answer;
    }
    const typed = {
        ...answer,
        importAttributes: {
            ...context.importAttributes,
            type: "json",
        },
    };
    assert.equal(typed.importAttributes.type, "json");
    return typed;
}

//
// The simulated module `specifier` names, as `effectModuleFor` finds it, or nothing for one that
// names none, worked out once per specifier for the life of the loader.
//
export async function simulatedModule(loader: ILoader, specifier: string): Promise<string | undefined> {
    assert(specifier.length > 0);
    if (loader.simulatedModules.has(specifier)) {
        return loader.simulatedModules.get(specifier);
    }
    const found = await effectModuleFor(loader.reading.fileSystem, specifier, path.join(loader.settings.toolModules, "world", "effects"));
    loader.simulatedModules.set(specifier, found);
    assert(loader.simulatedModules.has(specifier));
    return found;
}

//
// The project file `specifier` leads to from `importer`, as `resolveInProject` answers it, worked
// out once per importer and specifier for the life of the loader.
//
export async function keptResolution(loader: ILoader, specifier: string, importer: string): Promise<string | undefined> {
    assert(specifier.length > 0);
    assert(path.isAbsolute(importer));
    const key = `${importer}\0${specifier}`;
    if (loader.resolutions.has(key)) {
        return loader.resolutions.get(key);
    }
    const resolved = await resolveInProject(loader, specifier, importer);
    loader.resolutions.set(key, resolved);
    assert(loader.resolutions.has(key));
    return resolved;
}

//
// The project file an import written in `importer` leads to, as TypeScript resolves it, or nothing
// when it leads to a package or to a file TypeScript only has the types of. Those are Node's to
// find, because a package's types are not the code it runs.
//
export async function resolveInProject(loader: ILoader, specifier: string, importer: string): Promise<string | undefined> {
    assert(specifier.length > 0);
    assert(path.isAbsolute(importer));
    const options = await compilerOptions(loader, importer);
    const resolved = await untilKnown(loader.reading, () => ts.resolveModuleName(specifier, importer, options, moduleResolutionHost(loader.reading.known)).resolvedModule);
    if (!resolved) {
        return undefined;
    }
    if (resolved.isExternalLibraryImport) {
        return undefined;
    }
    if (resolved.resolvedFileName.endsWith(".d.ts")) {
        return undefined;
    }
    assert(path.isAbsolute(resolved.resolvedFileName));
    return resolved.resolvedFileName;
}

//
// The source Node runs for a module. A project's own TypeScript or JavaScript file is transpiled in
// memory with everything exported and an inline source map. An asset is a module with nothing in
// it. Anything else is left to Node.
//
export async function loadModule(
    loader: ILoader,
    url: string,
    context: module.LoadHookContext,
    nextLoad: NextLoad,
): Promise<module.LoadFnOutput> {
    assert(url.length > 0);
    const file = fileOf(url);
    if (!file) {
        return nextLoad(url, context);
    }
    if (assetExtensions.has(path.extname(file).toLowerCase())) {
        //
        // A CommonJS module with no source exports an empty object, so a default import of an
        // asset gets something rather than failing to link.
        //
        return {
            format: "commonjs",
            source: "",
            shortCircuit: true,
        };
    }
    if (!isProjectFile(loader.settings, file)) {
        return nextLoad(url, context);
    }
    if (!scriptExtensions.has(path.extname(file))) {
        return nextLoad(url, context);
    }
    const source = await loadedText(loader, file);
    assert(source.length > 0);
    return {
        format: await moduleFormat(loader, file),
        source,
        shortCircuit: true,
    };
}

//
// The text a project file is loaded as: the file transpiled by `transpile` in the format Node is
// told it is in, made once per file.
//
export async function loadedText(loader: ILoader, file: string): Promise<string> {
    assert(isProjectFile(loader.settings, file), `${file} is not a project file, so it is not transpiled.`);
    const kept = loader.transpiled.get(file);
    if (kept) {
        return kept;
    }
    const loaded = await keepTranspiled(loader, file, await loader.reading.fileSystem.readText(file));
    assert.equal(loader.transpiled.get(file), loaded);
    return loaded;
}

//
// Transpiles a project file's `text` as `loadedText` does and keeps the result, for a caller that
// has already read the file.
//
export async function keepTranspiled(loader: ILoader, file: string, text: string): Promise<string> {
    assert(path.isAbsolute(file));
    const loaded = transpile(file, text, await compilerOptions(loader, file), await moduleFormat(loader, file));
    loader.transpiled.set(file, loaded);
    assert(loaded.length > 0);
    return loaded;
}

//
// One project file as JavaScript in `format`, with every top-level declaration exported and the
// source map written into it, so coverage and stack traces read lines of the file as it is
// written.
//
// The project's own options are kept, so the code runs as its build writes it, apart from what a
// transpile in memory has to change: it emits, it writes no declarations, the module format is the
// one Node is told and JSX becomes calls when the project leaves JSX to some other tool.
//
export function transpile(file: string, text: string, options: ts.CompilerOptions, format: ModuleFormat): string {
    assert(file.length > 0);
    const output = ts.transpileModule(text, {
        fileName: file,
        reportDiagnostics: false,
        compilerOptions: {
            ...options,
            noEmit: false,
            declaration: false,
            sourceMap: false,
            inlineSourceMap: true,
            inlineSources: true,
            module: format === "module" ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
            //
            // Keeping every import as written is wrong for CommonJS output, which TypeScript turns
            // into `require` calls only when it may decide which imports to keep.
            //
            verbatimModuleSyntax: format === "module" ? options.verbatimModuleSyntax : false,
            jsx: options.jsx ?? ts.JsxEmit.ReactJSX,
        },
        transformers: {
            before: format === "module" ? [exportEverything, checkEntryPoint] : [exportEverything],
        },
    });
    assert(output.outputText.includes("sourceMappingURL=data:"));
    return output.outputText;
}

//
// The format Node is told a project file is in. The extension decides it when it says, as it does
// for Node. Otherwise the nearest `package.json` decides it, and a project that names no type gets
// ES modules, because TypeScript is written with `import` and `export` whatever it compiles to.
//
export async function moduleFormat(loader: ILoader, file: string): Promise<ModuleFormat> {
    assert(path.isAbsolute(file));
    const extension = path.extname(file);
    assert(extension.length > 0, `${file} has no extension, so it is not a file Faultline transpiles.`);
    if (extension === ".mts" || extension === ".mjs") {
        return "module";
    }
    if (extension === ".cts" || extension === ".cjs") {
        return "commonjs";
    }
    const type = await packageType(loader, await nearestPackageFile(loader.reading.fileSystem, file));
    return type === "commonjs" ? "commonjs" : "module";
}

//
// The `package.json` nearest a file: in its directory or the closest directory above it that has
// one, as Node finds it, or undefined when no directory up to the root of the disk has one.
//
export async function nearestPackageFile(fileSystem: IFileSystem, file: string): Promise<string | undefined> {
    assert(path.isAbsolute(file));
    let directory = path.dirname(file);
    //
    // Each turn moves one directory up, so a path has no more turns than it has parts, and the
    // last turn is the root, which is its own parent.
    //
    const turnsMost = file.split(path.sep).length;
    for (let turn = 0; turn < turnsMost; turn += 1) {
        const candidate = path.join(directory, "package.json");
        if (await fileSystem.isFile(candidate)) {
            return candidate;
        }
        const parent = path.dirname(directory);
        if (parent === directory) {
            break;
        }
        directory = parent;
    }
    assert.equal(path.dirname(directory), directory, `${file} has more directories above it than parts in its path.`);
    return undefined;
}

//
// Whether a value read from JSON is an object whose `type` is a string.
//
export function hasType(read: unknown): read is Record<"type", string> {
    if (typeof read !== "object") {
        return false;
    }
    if (!read) {
        return false;
    }
    if (!("type" in read)) {
        return false;
    }
    return typeof read.type === "string";
}

//
// The `type` a `package.json` gives, read once per file, or the empty string when it gives none or
// when there is no `package.json` above the file being loaded.
//
export async function packageType(loader: ILoader, packageFile: string | undefined): Promise<string> {
    if (!packageFile) {
        return "";
    }
    assert(path.isAbsolute(packageFile));
    assert.equal(path.basename(packageFile), "package.json");
    const kept = loader.packageTypes.get(packageFile);
    //
    // A package that names no type is kept as the empty string, which is an answer.
    //
    if (kept !== undefined) {
        return kept;
    }
    const read: unknown = JSON.parse(await loader.reading.fileSystem.readText(packageFile));
    const type = hasType(read) ? read.type : "";
    loader.packageTypes.set(packageFile, type);
    return type;
}

//
// The compiler options of the `tsconfig.json` that owns a project file, read once per config.
//
export async function compilerOptions(loader: ILoader, file: string): Promise<ts.CompilerOptions> {
    assert(path.isAbsolute(file));
    const config = await ownerConfig(loader.reading.fileSystem, loader.settings.projectRoot, file);
    const key = config ?? "";
    const kept = loader.options.get(key);
    if (kept) {
        return kept;
    }
    const options = await readCompilerOptions(loader.reading, config);
    loader.options.set(key, options);
    assert.equal(loader.options.get(key), options);
    return options;
}

//
// Whether a file is the project's own code: inside the project and not inside a package it
// installed. Only these are transpiled and resolved with the project's options.
//
export function isProjectFile(settings: ILoadSettings, file: string): boolean {
    assert(path.isAbsolute(settings.projectRoot));
    assert(path.isAbsolute(file));
    if (!isInside(settings.projectRoot, file)) {
        return false;
    }
    return !path.relative(settings.projectRoot, file).split(path.sep).includes("node_modules");
}

//
// Whether `file` is somewhere under `directory`.
//
export function isInside(directory: string, file: string): boolean {
    assert(path.isAbsolute(directory));
    assert(path.isAbsolute(file));
    return file.startsWith(`${directory}${path.sep}`);
}

//
// The path a `file:` URL names, without its query, or nothing for any other URL, such as a
// built-in module's.
//
export function fileOf(url: string | undefined): string | undefined {
    if (!url) {
        return undefined;
    }
    if (!url.startsWith("file:")) {
        return undefined;
    }
    const file = fileURLToPath(url);
    assert(path.isAbsolute(file));
    return file;
}
