//
// The results of earlier runs, kept in Faultline's cache directory, so a run does not execute again
// code that an earlier run already proved and that has not changed since. What is kept is the
// complete result of one shard: every call's tally, every failure and which code paths its calls
// exercised. A run that loads a shard's result reports it exactly as the run that made it did.
//
// A result is kept per shard: a source file, whose functions are called, or a sim file, whose
// scenarios are run. Each is stored with a key, a hash of the file and of every project file it
// imports at any depth, of the sim files its calls use (its own and every `global.sim.ts`), of the
// files under its `tsconfig.json` that declare something for every file, of the project's lockfile
// (which fixes every package it imports) and of Faultline's own version. A change to any of those
// gives a different key, and the result is not used.
//
// A code path of one file can be exercised by the calls of another: a private helper by the
// functions of the file that imports it, or anything by a scenario. So each result also names the
// shards whose calls exercised its code paths, with their keys. The result is used only while every
// one of them still has the key it had, and when a shard is run again, so is every shard that
// exercised its code paths, so the file gets what they exercised in it again.
//
// Each result also holds the answer of every kept crash of its shard replayed while the shard had
// that key. A replay depends on nothing outside the key, so a run in which the shard still has the
// key takes the answer from the result instead of replaying the crash, even when the shard itself
// runs again because a shard that contributes to it changed.
//

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";
import { augmentingFiles, ownerConfig } from "../discover/program.ts";
import { cacheDirectoryOf } from "../lib/cache-directory.ts";
import type { IFileSystem } from "../lib/file-system.ts";
import { untilKnown } from "../lib/known-files.ts";
import { createLoader, resolveInProject, type ILoader, type ILoadSettings } from "../load/hooks.ts";
import type { IShard } from "./driver.ts";
import type { IShardResult } from "./explore.ts";
import type { ICallAnswer } from "./judge.ts";
import { fileOfPathKey } from "./measure.ts";

//
// What a stored result says it is. A result written by any other version of this format is thrown
// away, so a change to the format never misreads an older result. The value is the number of the
// layout `writeEntry` writes now, and goes up by one with each change to that layout.
//
export const formatVersion = 2;

//
// The name a stored result starts with, so a file that is not a stored result is not read as one.
// It names the tool and what the file holds, which no other tool's file starts with.
//
const formatName = "faultline-results";

//
// The most project files one key follows. A project that imports more than this is beyond what any
// real project holds, so reaching it means the walk is following something it should not, and
// failing loudly beats hashing without end.
//
export const keyFilesMost = 1000000;

//
// A shard whose calls exercised code paths of the shard a result is of, and its key at the time.
//
export interface IContributor {
    //
    // The shard's file, relative to the project root.
    //
    file: string;

    //
    // Its key when the result was made.
    //
    key: string;
}

//
// The complete result of one shard.
//
export interface ICacheEntry {
    //
    // The shard's file, relative to the project root.
    //
    file: string;

    //
    // Its key when the result was made.
    //
    key: string;

    //
    // Every shard whose calls exercised one of its file's code paths, itself included.
    //
    contributors: IContributor[];

    //
    // What the shard's calls found.
    //
    result: IShardResult;

    //
    // The answer of every kept crash of the shard replayed while it had this key, in the order
    // replayed.
    //
    replays: ICallAnswer[];
}

//
// A stored result as it is written to disk.
//
export interface IStoredEntry {
    //
    // Always `formatName`.
    //
    format: string;

    //
    // The version of the format it was written in.
    //
    version: number;

    //
    // The result.
    //
    entry: ICacheEntry;
}

//
// The directory the results of a project are kept in, apart from the kept crashes, so throwing the
// results away leaves the crashes.
//
export function resultsDirectoryOf(projectRoot: string): string {
    assert(path.isAbsolute(projectRoot));
    const directory = path.join(cacheDirectoryOf(projectRoot), "results");
    assert(directory.startsWith(projectRoot));
    return directory;
}

//
// Where the result of `file` is kept under `directory`: a name made from a hash of the path, so a
// path's separators never have to be written into a file name. The name keeps the first 32 hex
// digits of the hash (128 bits), which keeps the files of a project apart and the name short. The
// entry itself names its file, and one that names another is not used.
//
export function entryPath(directory: string, file: string): string {
    assert(path.isAbsolute(directory));
    assert(file.length > 0);
    const entryFile = path.join(directory, `${createHash("sha256").update(file).digest("hex").slice(0, 32)}.json`);
    assert.equal(path.dirname(entryFile), directory);
    return entryFile;
}

//
// Writes `entry` in the form `readEntry` reads.
//
export function writeEntry(entry: ICacheEntry): string {
    assert(entry.file === entry.result.facts.file);
    assert(entry.key.length > 0);
    const stored: IStoredEntry = {
        format: formatName,
        version: formatVersion,
        entry,
    };
    const text = `${JSON.stringify(stored)}\n`;
    assert(text.endsWith("}\n"));
    return text;
}

//
// Reads what `writeEntry` wrote, or undefined for text that is not a stored result of this format
// version.
//
export function readEntry(text: string): ICacheEntry | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        //
        // Text that is not JSON is no stored result, which is what undefined says.
        //
        return undefined;
    }
    if (!isStoredEntry(parsed)) {
        return undefined;
    }
    if (parsed.format !== formatName) {
        return undefined;
    }
    if (parsed.version !== formatVersion) {
        return undefined;
    }
    assert(typeof parsed.entry.file === "string");
    assert(typeof parsed.entry.key === "string");
    return parsed.entry;
}

//
// Whether a value read from a stored result is laid out the way `writeEntry` writes one. Only the
// parts a run reads before it trusts the entry are checked: what wrote the rest is the same version
// of Faultline, which the key holds.
//
export function isStoredEntry(value: unknown): value is IStoredEntry {
    if (!isObject(value)) {
        return false;
    }
    if (!("format" in value)) {
        return false;
    }
    if (typeof value.format !== "string") {
        return false;
    }
    if (!("version" in value)) {
        return false;
    }
    if (typeof value.version !== "number") {
        return false;
    }
    if (!("entry" in value)) {
        return false;
    }
    return isEntryLaidOut(value.entry);
}

//
// Whether the entry of a stored result names its file and key and holds contributors, a result and
// replays, the parts `isStoredEntry` checks before a run trusts the rest.
//
export function isEntryLaidOut(entry: unknown): boolean {
    if (!isObject(entry)) {
        return false;
    }
    if (!("file" in entry)) {
        return false;
    }
    if (typeof entry.file !== "string") {
        return false;
    }
    if (!("key" in entry)) {
        return false;
    }
    if (typeof entry.key !== "string") {
        return false;
    }
    if (!("contributors" in entry)) {
        return false;
    }
    if (!Array.isArray(entry.contributors)) {
        return false;
    }
    if (!("result" in entry)) {
        return false;
    }
    if (!isObject(entry.result)) {
        return false;
    }
    if (!("replays" in entry)) {
        return false;
    }
    return Array.isArray(entry.replays);
}

//
// Whether a value read from JSON is an object or an array, which `in` can look inside, and not
// `null`, which `typeof` also calls an object.
//
export function isObject(value: unknown): value is object {
    if (typeof value !== "object") {
        return false;
    }
    return value !== null;
}

//
// The stored result of `file`, or undefined when there is none of this format, so the shard is
// executed again. A stored result that is there and cannot be read rejects with the error, because
// a run that quietly ignored its cache would hide what is wrong with it.
//
export async function readEntryFile(files: IFileSystem, directory: string, file: string): Promise<ICacheEntry | undefined> {
    const entryFile = entryPath(directory, file);
    if (!await files.isFile(entryFile)) {
        return undefined;
    }
    const entry = readEntry(await files.readText(entryFile));
    if (entry === undefined) {
        return undefined;
    }
    if (entry.file !== file) {
        return undefined;
    }
    assert(entry.key.length > 0);
    return entry;
}

//
// Stores the result of one shard under `directory`, making the directory.
//
export async function writeEntryFile(files: IFileSystem, directory: string, entry: ICacheEntry): Promise<void> {
    assert(path.isAbsolute(directory));
    assert(entry.file.length > 0);
    await files.makeDirectory(directory);
    await files.writeText(entryPath(directory, entry.file), writeEntry(entry));
}

//
// Throws away every kept result of a project, so the next run executes every shard. The kept
// crashes sit beside the results and are left.
//
export async function clearResults(files: IFileSystem, projectRoot: string): Promise<void> {
    const directory = resultsDirectoryOf(projectRoot);
    assert.notEqual(directory, cacheDirectoryOf(projectRoot));
    assert(directory.startsWith(cacheDirectoryOf(projectRoot)));
    await files.removeDirectory(directory);
}

//
// Every module a file's text names in an `import`, an `export ... from`, a `require` or an
// `import()`, in the order written.
//
export function importsOf(text: string): string[] {
    const imported = ts.preProcessFile(text, true, true).importedFiles;
    const specifiers = imported.map((reference) => reference.fileName);
    assert.equal(specifiers.length, imported.length);
    assert(specifiers.every((specifier) => typeof specifier === "string"));
    return specifiers;
}

//
// What a key is made from besides the files themselves.
//
export interface IKeyInputs {
    //
    // The absolute path of the project.
    //
    projectRoot: string;

    //
    // Where the project's files are read from.
    //
    files: IFileSystem;

    //
    // The project file an import written in `importer` leads to, as an absolute path, or undefined
    // when it leads to a package or a built-in module, whose code the salt covers.
    //
    resolve(specifier: string, importer: string): Promise<string | undefined>;

    //
    // The files under the `tsconfig.json` that owns `file` which declare something for every file,
    // relative to the project root. A shard's program holds them whether or not a file imports
    // them, so a shard's key covers them too.
    //
    augmenting(file: string): Promise<string[]>;

    //
    // Faultline's version and the project's lockfile, so a new Faultline or a new package throws
    // every result away.
    //
    salt: string;

    //
    // What this run has already worked out about each file, so a file every shard imports is read,
    // scanned and resolved once per run rather than once per shard. A run's files do not change
    // while it works out its keys, so the inputs are built anew for every run.
    //
    memo: IKeyMemo;
}

//
// What one run has worked out for its keys, each kept as the promise of it so shards worked out at
// the same time share the work.
//
export interface IKeyMemo {
    //
    // Each file's text and the project files it imports, by path from the project root.
    //
    files: Map<string, Promise<IKeyFile>>;

    //
    // The `tsconfig.json` that owns each directory, by absolute path.
    //
    owners: Map<string, Promise<string | undefined>>;

    //
    // The files that declare something for every file under each `tsconfig.json`, by its path.
    //
    augmenting: Map<string, Promise<string[]>>;
}

//
// What a key takes from one file.
//
export interface IKeyFile {
    //
    // The file's text, or undefined when it is not there.
    //
    text: string | undefined;

    //
    // The project files it imports, by path from the project root, in the order written.
    //
    imports: string[];
}

//
// A memo with nothing worked out yet, for the start of a run.
//
export function createKeyMemo(): IKeyMemo {
    return {
        files: new Map(),
        owners: new Map(),
        augmenting: new Map(),
    };
}

//
// The text of `file` and the project files it imports, worked out once per run. Only a script
// names the files it imports. Any other file a project file imports (a JSON file, say) is hashed
// for what it holds and imports nothing.
//
export function readKeyFile(inputs: IKeyInputs, file: string): Promise<IKeyFile> {
    assert(!path.isAbsolute(file));
    const known = inputs.memo.files.get(file);
    if (known) {
        return known;
    }
    const reading = workOutKeyFile(inputs, file);
    inputs.memo.files.set(file, reading);
    return reading;
}

//
// Reads `file` and resolves what it imports, for `readKeyFile` to keep.
//
export async function workOutKeyFile(inputs: IKeyInputs, file: string): Promise<IKeyFile> {
    const full = path.join(inputs.projectRoot, file);
    if (!await inputs.files.isFile(full)) {
        return {
            text: undefined,
            imports: [],
        };
    }
    const text = await inputs.files.readText(full);
    const imports: string[] = [];
    if ([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(path.extname(file))) {
        for (const specifier of importsOf(text)) {
            const resolved = await inputs.resolve(specifier, full);
            if (resolved !== undefined) {
                imports.push(path.relative(inputs.projectRoot, resolved).split(path.sep).join("/"));
            }
        }
    }
    assert(imports.every((name) => !path.isAbsolute(name)));
    return {
        text,
        imports,
    };
}

//
// The key of the files `roots` and of every project file they import, at any depth. Every root is
// relative to the project root. A file that is not there is hashed as missing, so it changes the
// key when it comes back. One that is there and cannot be read rejects with the error, because a
// key made without it would let a stale result through.
//
export async function keyOf(inputs: IKeyInputs, roots: string[]): Promise<string> {
    assert(path.isAbsolute(inputs.projectRoot));
    assert(roots.length > 0);
    const hash = createHash("sha256");
    hash.update(inputs.salt);
    hash.update("\0");
    const seen = new Set<string>();
    const queue: string[] = [];
    for (const root of roots) {
        if (!seen.has(root)) {
            seen.add(root);
            queue.push(root);
        }
    }
    for (let next = 0; next < queue.length; next += 1) {
        assert(next < keyFilesMost, "A key followed more project files than any project holds, which is a defect in Faultline.");
        const file = queue[next];
        assert(file !== undefined);
        hash.update(file);
        hash.update("\0");
        const keyFile = await readKeyFile(inputs, file);
        if (keyFile.text === undefined) {
            hash.update("missing\0");
            continue;
        }
        hash.update(keyFile.text);
        hash.update("\0");
        for (const imported of keyFile.imports) {
            if (!seen.has(imported)) {
                seen.add(imported);
                queue.push(imported);
            }
        }
    }
    assert.equal(seen.size, queue.length);
    return hash.digest("hex");
}

//
// The key of one shard: its file, the sim files its calls use (the one beside a source file and
// every `global.sim.ts`, or a sim file itself), the files under its `tsconfig.json` that declare
// something for every file and every project file those import.
//
export async function keyOfShard(inputs: IKeyInputs, shard: IShard): Promise<string> {
    assert(shard.file.length > 0);
    assert(shard.sims.every((sim) => sim.length > 0));
    const augmenting = await inputs.augmenting(shard.file);
    assert(augmenting.every((file) => !path.isAbsolute(file)));
    return keyOf(inputs, [shard.file, ...shard.sims, ...augmenting]);
}

//
// The key inputs of a project, resolving each import the way the module hooks do, through the
// importing file's own `tsconfig.json`. The settings name the project and the directory of
// Faultline's own modules, which the loader needs and no project import resolves into.
//
export function projectKeyInputs(files: IFileSystem, settings: ILoadSettings, salt: string): IKeyInputs {
    assert(path.isAbsolute(settings.projectRoot));
    assert(salt.length > 0);
    const loader = createLoader(settings, files);
    const memo = createKeyMemo();
    return {
        projectRoot: settings.projectRoot,
        files,
        resolve: (specifier: string, importer: string) => resolveInProject(loader, specifier, importer),
        augmenting: (file: string) => augmentingInProject(loader, file, memo),
        salt,
        memo,
    };
}

//
// The files under the `tsconfig.json` that owns `file` which declare something for every file,
// relative to the project root, found the way a shard's program finds them. A file no
// `tsconfig.json` owns has none, because its program is built over the shard's files alone. The
// owner of each directory and the files of each `tsconfig.json` are worked out once per run, in
// `memo`, because every shard under one `tsconfig.json` has the same ones.
//
export async function augmentingInProject(loader: ILoader, file: string, memo: IKeyMemo): Promise<string[]> {
    const root = loader.settings.projectRoot;
    assert(!path.isAbsolute(file));
    const directory = path.dirname(path.join(root, file));
    let owner = memo.owners.get(directory);
    if (!owner) {
        owner = ownerConfig(loader.reading.fileSystem, root, path.join(root, file));
        memo.owners.set(directory, owner);
    }
    const config = await owner;
    if (!config) {
        return [];
    }
    let found = memo.augmenting.get(config);
    if (!found) {
        found = untilKnown(loader.reading, () => augmentingFiles(loader.reading.known, config)).then((files) => files.map((full) => path.relative(root, full).split(path.sep).join("/")));
        memo.augmenting.set(config, found);
    }
    const relative = await found;
    assert(relative.every((name) => !name.startsWith("..")));
    return relative;
}

//
// The salt of every key of a project: Faultline's version and the text of each lockfile the
// project has. A lockfile that is not there adds its name alone, so adding one changes every key.
// One that is there and cannot be read rejects with the error, because a salt made without it would
// miss a change of package.
//
export async function saltOf(files: IFileSystem, projectRoot: string, faultlineVersion: string): Promise<string> {
    assert(path.isAbsolute(projectRoot));
    assert(faultlineVersion.length > 0);
    const parts = [`faultline ${faultlineVersion}`];
    //
    // The lockfiles of the package managers a Node project is installed with. The one a project has
    // fixes the version of every package its files import, so it stands in for reading them.
    //
    for (const name of ["bun.lock", "bun.lockb", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"]) {
        const lockfile = path.join(projectRoot, name);
        if (await files.isFile(lockfile)) {
            parts.push(`${name}\0${await files.readText(lockfile)}`);
        }
        else {
            parts.push(name);
        }
    }
    return parts.join("\0");
}

//
// The contributors of every shard of a run, from what each shard's calls exercised: for each shard,
// every shard whose calls exercised a code path of its file, in shard order. `keys` gives each
// shard's key in this run.
//
export function contributorsOf(results: IShardResult[], keys: Map<string, string>): Map<string, IContributor[]> {
    const touched = new Map<string, Set<string>>();
    for (const result of results) {
        const files = new Set(result.exercised.map((key) => fileOfPathKey(key)));
        files.add(result.facts.file);
        touched.set(result.facts.file, files);
    }
    const contributors = new Map<string, IContributor[]>();
    for (const result of results) {
        const file = result.facts.file;
        const list: IContributor[] = [];
        for (const other of results) {
            const touchedByOther = touched.get(other.facts.file);
            assert(touchedByOther !== undefined);
            if (!touchedByOther.has(file)) {
                continue;
            }
            const key = keys.get(other.facts.file);
            assert(key !== undefined, `${other.facts.file} has no key.`);
            list.push({
                file: other.facts.file,
                key,
            });
        }
        assert(list.some((contributor) => contributor.file === file));
        contributors.set(file, list);
    }
    assert.equal(contributors.size, touched.size);
    return contributors;
}

//
// What a run knows about one shard when it decides whether its stored result can be used.
//
export interface IUnit {
    //
    // The shard's file, relative to the project root.
    //
    file: string;

    //
    // Its key in this run.
    //
    key: string;

    //
    // Its stored result, or undefined when there is none of this format.
    //
    entry: ICacheEntry | undefined;
}

//
// Which of `units` have to run again, one answer per unit in order. A unit runs again when it has
// no stored result, a stored result with another key, or a contributor whose key is not what it
// was. Then every contributor of a unit that runs again runs again too, until no more are added, so
// a file run again gets the code paths those shards exercised in it.
//
export function unitsToRun(units: IUnit[]): boolean[] {
    const positions = new Map(units.map((unit, position) => [unit.file, position]));
    const toRun = units.map((unit) => !isUsable(units, positions, unit));
    let isChanged = true;
    //
    // Each pass that changes something marks at least one more unit, so one pass per unit and a
    // last pass that changes nothing are always enough.
    //
    for (let pass = 0; pass <= units.length; pass += 1) {
        if (!isChanged) {
            break;
        }
        isChanged = markContributors(units, positions, toRun);
    }
    assert.equal(isChanged, false);
    assert.equal(toRun.length, units.length);
    return toRun;
}

//
// Marks to run every contributor of each unit already marked to run, and says whether it marked
// one that was not marked before, so `unitsToRun` knows whether to look again.
//
export function markContributors(units: IUnit[], positions: Map<string, number>, toRun: boolean[]): boolean {
    assert.equal(toRun.length, units.length);
    const markedBefore = toRun.filter((isToRun) => isToRun).length;
    units.forEach((unit, position) => {
        if (!toRun[position]) {
            return;
        }
        if (unit.entry === undefined) {
            return;
        }
        for (const contributor of unit.entry.contributors) {
            const found = positions.get(contributor.file);
            if (found !== undefined) {
                toRun[found] = true;
            }
        }
    });
    const markedAfter = toRun.filter((isToRun) => isToRun).length;
    assert(markedAfter >= markedBefore);
    return markedAfter > markedBefore;
}

//
// Whether a unit's stored result can be used as it is.
//
export function isUsable(units: IUnit[], positions: Map<string, number>, unit: IUnit): boolean {
    assert.equal(positions.size, units.length);
    assert(positions.has(unit.file));
    const entry = unit.entry;
    if (entry === undefined) {
        return false;
    }
    if (entry.key !== unit.key) {
        return false;
    }
    if (entry.file !== unit.file) {
        return false;
    }
    for (const contributor of entry.contributors) {
        const position = positions.get(contributor.file);
        if (position === undefined) {
            return false;
        }
        const contributing = units[position];
        assert(contributing !== undefined);
        if (contributing.key !== contributor.key) {
            return false;
        }
    }
    return true;
}
