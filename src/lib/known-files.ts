//
// What the TypeScript compiler is allowed to read: the files, directories and links Faultline has
// already read into memory, without blocking, from an `IFileSystem`.
//
// The compiler reads files synchronously and cannot wait for a promise, so it is never given the
// disk. It is given these answers in memory, and every question it asks that has no answer yet is
// written down as a miss. `untilKnown` then reads every miss asynchronously and asks the compiler
// again, until it asks nothing new. Each round answers the questions of the round before, so the
// rounds end once every file the compiler follows has been read.
//

import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { isCodedError, type IDirectoryEntry, type IFileSystem } from "./file-system.ts";

//
// What kind of question a miss is.
//
export type MissKind = "text" | "file" | "directory" | "listing" | "real-path";

//
// One question the compiler asked that had no answer in memory.
//
export interface IMiss {
    //
    // What it asked.
    //
    kind: MissKind;

    //
    // The absolute path it asked about.
    //
    path: string;
}

//
// The answers held in memory, and the questions that had none.
//
export interface IKnownFiles {
    //
    // The text of each file read, or undefined for a path that is not a readable file, by path.
    //
    texts: Map<string, string | undefined>;

    //
    // Whether each path asked about is a file.
    //
    files: Map<string, boolean>;

    //
    // Whether each path asked about is a directory.
    //
    directories: Map<string, boolean>;

    //
    // The entries of each directory listed, empty for a path that is not a directory.
    //
    listings: Map<string, IDirectoryEntry[]>;

    //
    // Where each path asked about leads once its links are followed.
    //
    realPaths: Map<string, string>;

    //
    // Each file the compiler parsed, by its path and the language version it was parsed for, so a
    // round parses again only the files the round before had not read.
    //
    parsed: Map<string, ts.SourceFile>;

    //
    // The questions asked since the misses were last read.
    //
    misses: IMiss[];
}

//
// Where a compiler reads from: the file system the answers come from and the answers read so far,
// kept together so every program built over the same files shares what was read for the others.
//
export interface IReading {
    //
    // Where the answers are read from.
    //
    fileSystem: IFileSystem;

    //
    // The answers read so far.
    //
    known: IKnownFiles;
}

//
// A reading over `fileSystem` with nothing read yet.
//
export function createReading(fileSystem: IFileSystem): IReading {
    const reading: IReading = {
        fileSystem,
        known: createKnownFiles(),
    };
    assert.equal(reading.fileSystem, fileSystem);
    assert.equal(reading.known.misses.length, 0);
    return reading;
}

//
// How many rounds `untilKnown` makes before it takes the compiler to be asking forever. A round
// answers every question of the round before, so a program needs as many rounds as the longest
// chain of files that lead one to the next, and this is far past the longest chain a real project
// has. A program asking past this is a defect in Faultline, and failing loudly beats a run that
// never ends.
//
export const roundsMost = 10000;

//
// Answers for a reading that has read nothing yet, so its first build misses every file it asks
// about.
//
export function createKnownFiles(): IKnownFiles {
    const known: IKnownFiles = {
        texts: new Map(),
        files: new Map(),
        directories: new Map(),
        listings: new Map(),
        realPaths: new Map(),
        parsed: new Map(),
        misses: [],
    };
    assert.equal(known.texts.size, 0);
    assert.equal(known.misses.length, 0);
    return known;
}

//
// Writes down a question that had no answer.
//
export function addMiss(known: IKnownFiles, kind: MissKind, file: string): void {
    assert(path.isAbsolute(file), `The compiler asked about ${file}, which is not an absolute path.`);
    known.misses.push({
        kind,
        path: file,
    });
    assert(known.misses.length > 0);
}

//
// The text of a file, or undefined when it is not a readable file or has not been read yet.
//
export function knownText(known: IKnownFiles, file: string): string | undefined {
    assert(path.isAbsolute(file));
    if (!known.texts.has(file)) {
        addMiss(known, "text", file);
        return undefined;
    }
    const text = known.texts.get(file);
    if (text !== undefined) assert(typeof text === "string");
    return text;
}

//
// Whether a path is a file, or no when it has not been asked about yet.
//
export function knownIsFile(known: IKnownFiles, file: string): boolean {
    assert(path.isAbsolute(file));
    const answer = known.files.get(file);
    if (answer === undefined) {
        addMiss(known, "file", file);
        return false;
    }
    if (answer) assert(known.directories.get(file) !== true);
    return answer;
}

//
// Whether a path is a directory, or no when it has not been asked about yet.
//
export function knownIsDirectory(known: IKnownFiles, directory: string): boolean {
    assert(path.isAbsolute(directory));
    const answer = known.directories.get(directory);
    if (answer === undefined) {
        addMiss(known, "directory", directory);
        return false;
    }
    if (answer) assert(known.files.get(directory) !== true);
    return answer;
}

//
// The entries of a directory, or none when it has not been listed yet.
//
export function knownListing(known: IKnownFiles, directory: string): IDirectoryEntry[] {
    assert(path.isAbsolute(directory));
    const listing = known.listings.get(directory);
    if (!listing) {
        addMiss(known, "listing", directory);
        return [];
    }
    if (listing.length > 0) assert(known.directories.get(directory) !== false);
    return listing;
}

//
// Where a path leads, or the path itself when that has not been read yet.
//
export function knownRealPath(known: IKnownFiles, file: string): string {
    assert(path.isAbsolute(file));
    const real = known.realPaths.get(file);
    if (!real) {
        addMiss(known, "real-path", file);
        return file;
    }
    assert(path.isAbsolute(real));
    return real;
}

//
// The text of a file, or undefined when it is not a readable file. A file that cannot be read is
// one the compiler reports it could not find, which is the error the project's own build would
// give, so the reason is not needed here.
//
export async function readTextOrNothing(fileSystem: IFileSystem, file: string): Promise<string | undefined> {
    assert(path.isAbsolute(file));
    let text: string;
    try {
        text = await fileSystem.readText(file);
    }
    catch (error) {
        assert(!(error instanceof assert.AssertionError), `Reading ${file} broke an assertion in the file system, which is a defect in Faultline.`);
        assert(isCodedError(error), `Reading ${file} failed with something that is not an error Node raised.`);
        return undefined;
    }
    assert(typeof text === "string");
    return text;
}

//
// The entries of a directory, or none when it is not one.
//
export async function listingOrNothing(fileSystem: IFileSystem, directory: string): Promise<IDirectoryEntry[]> {
    assert(path.isAbsolute(directory));
    if (!await fileSystem.isDirectory(directory)) {
        return [];
    }
    const listing = await fileSystem.listDirectory(directory);
    assert(listing.every((entry) => entry.name.length > 0));
    return listing;
}

//
// Where a path leads, or the path itself when it cannot be followed, as the compiler's own host
// answers. The compiler asks only about paths it has found.
//
export async function realPathOrSelf(fileSystem: IFileSystem, file: string): Promise<string> {
    assert(path.isAbsolute(file));
    let real: string;
    try {
        real = await fileSystem.realPath(file);
    }
    catch (error) {
        assert(!(error instanceof assert.AssertionError), `Following ${file} broke an assertion in the file system, which is a defect in Faultline.`);
        assert(isCodedError(error), `Following ${file} failed with something that is not an error Node raised.`);
        return file;
    }
    assert(path.isAbsolute(real));
    return real;
}

//
// Reads the answer to one miss into memory.
//
export async function answerMiss(fileSystem: IFileSystem, known: IKnownFiles, miss: IMiss): Promise<void> {
    assert(path.isAbsolute(miss.path));
    if (miss.kind === "text") {
        known.texts.set(miss.path, await readTextOrNothing(fileSystem, miss.path));
        return;
    }
    if (miss.kind === "file") {
        known.files.set(miss.path, await fileSystem.isFile(miss.path));
        return;
    }
    if (miss.kind === "directory") {
        known.directories.set(miss.path, await fileSystem.isDirectory(miss.path));
        return;
    }
    if (miss.kind === "listing") {
        known.listings.set(miss.path, await listingOrNothing(fileSystem, miss.path));
        return;
    }
    assert.equal(miss.kind, "real-path");
    known.realPaths.set(miss.path, await realPathOrSelf(fileSystem, miss.path));
}

//
// Reads the answer to every miss into memory, all at once, and forgets the misses.
//
export async function answerMisses(fileSystem: IFileSystem, known: IKnownFiles): Promise<void> {
    const misses = known.misses;
    assert(misses.length > 0, "There are no misses to read, so a round was made for nothing.");
    known.misses = [];
    await Promise.all(misses.map((miss) => answerMiss(fileSystem, known, miss)));
    assert.equal(known.misses.length, 0);
}

//
// Runs `build` over what is known, reading what it missed and running it again until it misses
// nothing, and hands back what the last run built. `build` must read files only through `known`.
//
export async function untilKnown<Built>(reading: IReading, build: () => Built): Promise<Built> {
    assert.equal(reading.known.misses.length, 0, "Misses from another build are waiting to be read.");
    for (let round = 0; round < roundsMost; round += 1) {
        const built = build();
        if (reading.known.misses.length === 0) {
            return built;
        }
        await answerMisses(reading.fileSystem, reading.known);
        assert.equal(reading.known.misses.length, 0);
    }
    assert.fail(`The compiler was still asking for files after ${roundsMost} rounds, which is a defect in Faultline.`);
}
