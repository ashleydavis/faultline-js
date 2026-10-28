//
// Every file Faultline reads or writes, the project's and its own, goes through one interface, so
// the code that reads and writes them is tested against a file system in memory and only the entry
// points that start a Faultline process build the real one. Every call is asynchronous,
// so reading a project never blocks the process that is fault testing it.
//

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

//
// What a directory entry is, as far as Faultline cares: a file it can read, a directory it can walk
// into or anything else (a symbolic link, a socket or a device), which it leaves alone.
//
export type EntryKind = "file" | "directory" | "other";

//
// One entry of a directory.
//
export interface IDirectoryEntry {
    //
    // The entry's own name, without the directory it is in.
    //
    name: string;

    //
    // What it is. A symbolic link is `other` and is never followed, so a walk never reads a file
    // twice or leaves the project through one.
    //
    kind: EntryKind;
}

//
// The files Faultline reads and writes. A failed call rejects with the error Node's own call
// rejects with, carrying its `code`, so a caller tells a missing file (`ENOENT`) from one it cannot
// read. Asking whether a path is a file or a directory answers no for a path that is not there,
// because a missing path is the answer and not a failure.
//
export interface IFileSystem {
    //
    // The text of a file, read as UTF-8.
    //
    readText(file: string): Promise<string>;

    //
    // Whether a file is there, following links.
    //
    isFile(file: string): Promise<boolean>;

    //
    // Whether a directory is there, following links.
    //
    isDirectory(directory: string): Promise<boolean>;

    //
    // The entries of a directory.
    //
    listDirectory(directory: string): Promise<IDirectoryEntry[]>;

    //
    // The path a path leads to once every link in it is followed.
    //
    realPath(file: string): Promise<string>;

    //
    // Writes the text of a file as UTF-8, replacing what was there. The directory has to exist.
    //
    writeText(file: string, text: string): Promise<void>;

    //
    // Moves a file to a new path in the same directory, replacing a file there in one step, so a
    // reader sees the old file or the new one and never part of one.
    //
    rename(from: string, to: string): Promise<void>;

    //
    // Makes a directory and every directory above it that is missing. One that is there already is
    // left as it is.
    //
    makeDirectory(directory: string): Promise<void>;

    //
    // Removes a directory and everything in it. One that is not there is left as it is.
    //
    removeDirectory(directory: string): Promise<void>;
}

//
// Whether something thrown is an error Node raised with a code, so a caller can tell one failure
// from another without a cast.
//
export function isCodedError(thrown: unknown): thrown is NodeJS.ErrnoException {
    if (!(thrown instanceof Error)) {
        return false;
    }
    if (!("code" in thrown)) {
        return false;
    }
    return typeof thrown.code === "string";
}

//
// What kind of entry a directory entry Node read is.
//
export function entryKind(entry: fs.Dirent): EntryKind {
    assert(entry.name.length > 0);
    assert(!entry.name.includes(path.sep));
    if (entry.isFile()) {
        return "file";
    }
    if (entry.isDirectory()) {
        return "directory";
    }
    return "other";
}

//
// The entries Node read, written the way the interface gives them.
//
export function directoryEntries(read: fs.Dirent[]): IDirectoryEntry[] {
    const entries = read.map((entry) => ({
        name: entry.name,
        kind: entryKind(entry),
    }));
    assert.equal(entries.length, read.length);
    assert(entries.every((entry, index) => entry.name === read[index].name));
    return entries;
}

//
// What Node knows about a path, or undefined when the path is not there. Any other failure is the
// caller's to see, because a path that cannot be read is not a path that is missing.
//
export function statOrNothing(file: string): Promise<fs.Stats | undefined> {
    assert(path.isAbsolute(file));
    return new Promise((resolve, reject) => {
        fs.stat(file, (error, stats) => {
            if (!error) {
                assert(stats);
                resolve(stats);
                return;
            }
            if (error.code === "ENOENT") {
                resolve(undefined);
                return;
            }
            assert(isCodedError(error), `Reading what ${file} is failed with an error that carries no code.`);
            reject(error);
        });
    });
}

//
// The real file system, over `node:fs`. Only the entry points that start a Faultline process build
// one.
//
export class FileSystem implements IFileSystem {
    //
    // Reads a project file or one of Faultline's own.
    //
    async readText(file: string): Promise<string> {
        assert(path.isAbsolute(file));
        assert(!file.endsWith(path.sep));
        const text = await fs.promises.readFile(file, {
            encoding: "utf8",
        });
        assert(typeof text === "string");
        return text;
    }

    //
    // Tells a file apart from a directory and from nothing at all.
    //
    async isFile(file: string): Promise<boolean> {
        assert(path.isAbsolute(file));
        const stats = await statOrNothing(file);
        if (!stats) {
            return false;
        }
        if (stats.isFile()) assert(!stats.isDirectory());
        return stats.isFile();
    }

    //
    // Tells a directory apart from a file and from nothing at all.
    //
    async isDirectory(directory: string): Promise<boolean> {
        assert(path.isAbsolute(directory));
        const stats = await statOrNothing(directory);
        if (!stats) {
            return false;
        }
        if (stats.isDirectory()) assert(!stats.isFile());
        return stats.isDirectory();
    }

    //
    // Lists a directory with the kind of each entry, so a walk never has to ask again.
    //
    async listDirectory(directory: string): Promise<IDirectoryEntry[]> {
        assert(path.isAbsolute(directory));
        const entries = directoryEntries(await fs.promises.readdir(directory, {
            withFileTypes: true,
        }));
        assert(entries.every((entry) => !entry.name.includes(path.sep)));
        return entries;
    }

    //
    // Finds where a path leads, for the compiler, which reads a package through the place a link
    // points at.
    //
    async realPath(file: string): Promise<string> {
        assert(path.isAbsolute(file));
        const real = await fs.promises.realpath(file, {
            encoding: "utf8",
        });
        assert(path.isAbsolute(real));
        return real;
    }

    //
    // Writes one of Faultline's own files in its cache directory.
    //
    async writeText(file: string, text: string): Promise<void> {
        assert(path.isAbsolute(file));
        assert(!file.endsWith(path.sep));
        assert(typeof text === "string");
        await fs.promises.writeFile(file, text, {
            encoding: "utf8",
        });
    }

    //
    // Moves one of Faultline's own files into place in its cache directory.
    //
    async rename(from: string, to: string): Promise<void> {
        assert(path.isAbsolute(from));
        assert(path.isAbsolute(to));
        assert.equal(path.dirname(from), path.dirname(to), `${from} and ${to} are not in the same directory, so the move would not be one step.`);
        await fs.promises.rename(from, to);
    }

    //
    // Makes Faultline's cache directory, and the ones above it a fresh project lacks.
    //
    async makeDirectory(directory: string): Promise<void> {
        assert(path.isAbsolute(directory));
        assert(directory !== path.parse(directory).root);
        await fs.promises.mkdir(directory, {
            recursive: true,
        });
    }

    //
    // Throws away a directory of Faultline's own, which may not have been made yet.
    //
    async removeDirectory(directory: string): Promise<void> {
        assert(path.isAbsolute(directory));
        assert(directory !== path.parse(directory).root);
        await fs.promises.rm(directory, {
            recursive: true,
            force: true,
        });
    }
}
