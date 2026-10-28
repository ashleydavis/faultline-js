//
// Keeps what the compiler says about each file of a project between runs, so a file that has not
// changed is never read with the compiler again: not by the next shard, not by the next child and
// not by the next run.
//
// What is kept is what the reader thread works out: a shard's reading (its functions, conditions
// and sim facts) and a file's measurement (where its code paths sit in the loaded text). Each is
// kept under a key that covers everything it was worked out from, and an entry is used only when
// the key stored in it is the key worked out now. Anything else, an entry that cannot be decoded
// included, is a miss and is worked out again, so a wrong entry is never used.
//

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import type { MeasuredFile } from "../coverage/v8.ts";
import { ownerConfig, readCompilerOptions } from "../discover/program.ts";
import { cacheDirectoryOf } from "../lib/cache-directory.ts";
import type { IFileSystem } from "../lib/file-system.ts";
import { nearestPackageFile, type ILoader } from "../load/hooks.ts";
import { keyOfShard, projectKeyInputs, saltOf, type IKeyInputs } from "./results-cache.ts";
import type { IShardReader } from "./shard-reader.ts";
import type { IShardReading } from "./shard.ts";

//
// The first line of every entry. It changes when what an entry holds is laid out another way, so
// an entry an older Faultline wrote is a miss rather than something read wrongly.
//
export const compileEntryFormat = "faultline-compiled 1";

//
// The most files and directories of Faultline's own code hashed into the salt. Faultline's own
// modules number in the hundreds, so a walk past this is reading something that is not Faultline.
//
export const toolEntriesMost = 100000;

//
// The directory the compiled entries of a project are kept in, beside the kept results, so
// `npx flt clear` throws both away.
//
export function compileCacheDirectory(projectRoot: string): string {
    assert(path.isAbsolute(projectRoot));
    const directory = path.join(cacheDirectoryOf(projectRoot), "compiled");
    assert(directory.startsWith(cacheDirectoryOf(projectRoot)));
    return directory;
}

//
// The text of an entry: the format line, the key and the value in V8's own serialized form as
// base64. V8's form is the one the reader thread already sends its replies in, so whatever a reply
// can carry an entry can keep.
//
export function writeCompileEntry<T>(key: string, value: T): string {
    assert(key.length > 0);
    assert(!key.includes("\n"));
    const encoded = v8.serialize(value).toString("base64");
    assert(!encoded.includes("\n"));
    return `${compileEntryFormat}\n${key}\n${encoded}\n`;
}

//
// The value an entry's text holds when it was written under `key`, or undefined when it was
// written under another key, by another format, cut short or cannot be decoded. Each of those is a
// miss, so the caller works the value out again.
//
// The key covers Faultline's own code and everything the value was worked out from, so an entry
// whose key matches was written by this code from a value of the type the caller names. That is
// what makes the value's type known, and why nothing else about it is checked.
//
export function readCompileEntry<T>(text: string, key: string): T | undefined {
    assert(key.length > 0);
    const lines = text.split("\n");
    if (lines.length !== 4) {
        return undefined;
    }
    if (lines[0] !== compileEntryFormat) {
        return undefined;
    }
    if (lines[1] !== key) {
        return undefined;
    }
    if (lines[3] !== "") {
        return undefined;
    }
    const encoded = lines[2];
    assert(encoded !== undefined);
    //
    // V8 throws on text that is not what it wrote. That is a miss and not a failure, because the
    // value is worked out again.
    //
    try {
        return v8.deserialize(Buffer.from(encoded, "base64"));
    }
    catch {
        return undefined;
    }
}

//
// The name of the entry file that keeps what `kind` worked out for `name`: one file per shard or
// per measured file, which a changed key writes over, so the directory does not grow with every
// edit.
//
export function compileEntryName(kind: "read" | "measure", name: string): string {
    assert(name.length > 0);
    const hashed = createHash("sha256").update(kind).update("\0").update(name).digest("hex");
    assert.equal(hashed.length, 64);
    return `${kind}-${hashed}.txt`;
}

//
// A hash of every file of Faultline's own code under `toolModules`, by path and text. A key holds
// it, so a Faultline whose code changed throws every entry away, even one used from a clone whose
// version number stayed the same.
//
export async function hashToolCode(files: IFileSystem, toolModules: string): Promise<string> {
    assert(path.isAbsolute(toolModules));
    const hash = createHash("sha256");
    const directories = [toolModules];
    let entries = 0;
    for (let next = 0; next < directories.length; next += 1) {
        const directory = directories[next];
        assert(directory !== undefined);
        //
        // Taken in the order their names sort, by code unit, so the hash does not depend on the
        // order a directory happens to list its entries in.
        //
        const listed = new Map((await files.listDirectory(directory)).map((entry) => [entry.name, entry.kind]));
        for (const name of [...listed.keys()].sort()) {
            entries += 1;
            assert(entries < toolEntriesMost, `Faultline's own code under ${toolModules} holds more than ${toolEntriesMost} entries, which is a defect in Faultline.`);
            const full = path.join(directory, name);
            if (listed.get(name) === "directory") {
                directories.push(full);
                continue;
            }
            hash.update(path.relative(toolModules, full));
            hash.update("\0");
            hash.update(await files.readText(full));
            hash.update("\0");
        }
    }
    const hashed = hash.digest("hex");
    assert.equal(hashed.length, 64);
    return hashed;
}

//
// A hash of text that may hold any character, a file's text or the salt, so it can be one part of
// a key.
//
export function hashText(text: string): string {
    const hashed = createHash("sha256").update(text).digest("hex");
    assert.equal(hashed.length, 64);
    return hashed;
}

//
// A hash of the parts of a key, joined with `\0`, which no path and no JSON text holds, as the keys
// of the kept results are.
//
export function hashParts(parts: string[]): string {
    assert(parts.length > 0);
    const hashed = createHash("sha256").update(parts.join("\0")).digest("hex");
    assert.equal(hashed.length, 64);
    return hashed;
}

//
// What a compile cache is made with.
//
export interface ICompileCacheSettings {
    //
    // The reader that works a value out when the cache has no entry for it.
    //
    inner: IShardReader;

    //
    // How the project's files are read and resolved, which the keys are worked out with.
    //
    loader: ILoader;

    //
    // Where the entries are read from and written to.
    //
    files: IFileSystem;

    //
    // The directory the entries are kept in.
    //
    directory: string;
}

//
// A reader that keeps what `inner` works out between runs, under keys that cover everything it was
// worked out from.
//
export class CachedShardReader implements IShardReader {
    //
    // The reader that works a value out on a miss.
    //
    private inner: IShardReader;

    //
    // How the project's files are read, which the compiler options in a key come from.
    //
    private loader: ILoader;

    //
    // Where the entries live.
    //
    private files: IFileSystem;

    //
    // The directory of the entries.
    //
    private directory: string;

    //
    // The key inputs of the project, worked out once: the salt (Faultline's own code and the
    // lockfile) and how an import resolves.
    //
    private inputs: Promise<IKeyInputs> | undefined;

    //
    // Builds a cache over `inner`.
    //
    constructor(settings: ICompileCacheSettings) {
        assert(path.isAbsolute(settings.directory));
        assert(path.isAbsolute(settings.loader.settings.projectRoot));
        this.inner = settings.inner;
        this.loader = settings.loader;
        this.files = settings.files;
        this.directory = settings.directory;
        this.inputs = undefined;
    }

    //
    // The project's key inputs, worked out on first use. Faultline's own code is hashed then, once
    // per reader, rather than once per key.
    //
    keyInputs(): Promise<IKeyInputs> {
        if (!this.inputs) {
            this.inputs = this.buildKeyInputs();
        }
        return this.inputs;
    }

    //
    // Builds the project's key inputs: hashes Faultline's own code, reads the lockfile and sets up
    // how an import resolves.
    //
    async buildKeyInputs(): Promise<IKeyInputs> {
        const settings = this.loader.settings;
        const toolHash = await hashToolCode(this.files, settings.toolModules);
        const salt = await saltOf(this.files, settings.projectRoot, toolHash);
        assert(salt.includes(toolHash));
        return projectKeyInputs(this.files, settings, salt);
    }

    //
    // The compiler options of the `tsconfig.json` that owns `full`, written out, so a key changes
    // when the options a file is compiled with change, those of a config it extends included.
    //
    async optionsText(full: string): Promise<string> {
        assert(path.isAbsolute(full));
        const root = this.loader.settings.projectRoot;
        const config = await ownerConfig(this.loader.reading.fileSystem, root, full);
        const options = await readCompilerOptions(this.loader.reading, config);
        const text = JSON.stringify(options);
        assert(text.length > 0);
        return text;
    }

    //
    // The key of a shard's reading: the shard's key in the kept results (its file, its sim files,
    // the files under its `tsconfig.json` that declare something for every file and every project
    // file those import at any depth, with the salt) and the compiler options of the shard's file.
    //
    async readingKey(file: string, sims: string[]): Promise<string> {
        assert(!path.isAbsolute(file));
        const inputs = await this.keyInputs();
        const files = await keyOfShard(inputs, {
            file,
            sims,
        });
        const options = await this.optionsText(path.join(inputs.projectRoot, file));
        return hashParts(["read", file, ...sims, files, options]);
    }

    //
    // The key of a file's measurement: the file's text, the salt, the compiler options it is
    // transpiled with and the nearest `package.json`, whose `type` decides its module format.
    //
    async measurementKey(full: string): Promise<string> {
        assert(path.isAbsolute(full));
        const inputs = await this.keyInputs();
        const text = await this.files.readText(full);
        const options = await this.optionsText(full);
        const packageFile = await nearestPackageFile(this.files, full);
        const packageText = packageFile ? await this.files.readText(packageFile) : "";
        return hashParts(["measure", hashText(inputs.salt), full, hashText(text), options, packageFile ?? "", hashText(packageText)]);
    }

    //
    // Reads the entry `name` written under `key`, or undefined when there is none or it is a miss.
    //
    async readStored<T>(name: string, key: string): Promise<T | undefined> {
        const file = path.join(this.directory, name);
        if (!await this.files.isFile(file)) {
            return undefined;
        }
        return readCompileEntry<T>(await this.files.readText(file), key);
    }

    //
    // Writes the entry `name` under `key`. It is written beside its place and moved there in one
    // step, so a worker reading it at the same moment reads the old entry or the new one.
    //
    async store<T>(name: string, key: string, value: T): Promise<void> {
        await this.files.makeDirectory(this.directory);
        const file = path.join(this.directory, name);
        const written = `${file}.${process.pid}.${randomUUID()}.tmp`;
        await this.files.writeText(written, writeCompileEntry(key, value));
        await this.files.rename(written, file);
        assert(await this.files.isFile(file));
    }

    //
    // A shard's reading from its entry, or read with the compiler and kept when there is none.
    //
    async read(file: string, sims: string[]): Promise<IShardReading> {
        assert(file.length > 0);
        assert(Array.isArray(sims));
        const key = await this.readingKey(file, sims);
        const name = compileEntryName("read", [file, ...sims].join("\0"));
        const stored = await this.readStored<IShardReading>(name, key);
        if (stored) {
            return stored;
        }
        const reading = await this.inner.read(file, sims);
        await this.store(name, key, reading);
        return reading;
    }

    //
    // A file's measurement from its entry, or measured and kept when there is none. A URL that
    // names no file of the project is measured each time, because measuring it costs nothing.
    //
    async measure(url: string): Promise<MeasuredFile | undefined> {
        assert(url.length > 0);
        if (!url.startsWith("file:")) {
            return this.inner.measure(url);
        }
        const full = fileURLToPath(url);
        const root = this.loader.settings.projectRoot;
        if (!full.startsWith(`${root}${path.sep}`)) {
            return this.inner.measure(url);
        }
        if (!await this.files.isFile(full)) {
            return this.inner.measure(url);
        }
        const key = await this.measurementKey(full);
        const name = compileEntryName("measure", url);
        const stored = await this.readStored<MeasuredFile>(name, key);
        if (stored) {
            assert.equal(stored.url, url);
            return stored;
        }
        const measured = await this.inner.measure(url);
        if (measured) {
            await this.store(name, key, measured);
        }
        return measured;
    }
}
