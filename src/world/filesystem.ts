// The simulated filesystem: a tree held in memory that one run owns.
//
// It starts holding only the root directory, so no call reaches the disk and no run can read the
// machine or write into the project it is measuring. A scenario writes the files a call needs. It
// has files, directories, symbolic links and hard links, follows links the way Linux does and lists
// a directory in sorted order, so a replay lists the same way on every machine.
//
// Every operation asks the injector before it does anything, under the group of the failure table
// it belongs to, and fails the way Node fails when the injector says so. The operations are
// synchronous and throw. The replaced `node:fs` builds its callback and promise forms on them.

import assert from "node:assert/strict";
import path from "node:path";
import type { RunClock } from "./clock.ts";
import { CodedError, codeOf, fileError, hasCode } from "./effects.ts";
import type { Effect } from "./failures.ts";
import type { Injector } from "./injector.ts";
import type { SeededRng } from "./random.ts";

// What an entry of the tree is.
export type EntryKind = "file" | "directory" | "symlink";

// One file, directory or link. Two paths that hold the same entry are hard links to one file.
export interface Entry {
    // What the entry is.
    kind: EntryKind;

    // What a file holds. Empty for a directory or a link.
    bytes: Buffer;

    // Where a link points, as it was written. Empty for a file or a directory.
    target: string;

    // The permission bits, as `chmod` sets them.
    mode: number;

    // The number `stat` gives the entry, unique within the tree.
    inode: number;

    // The owner, as `chown` sets it.
    userId: number;

    // The owning group.
    groupId: number;

    // When it was last read, in milliseconds since the epoch.
    accessedMs: number;

    // When what it holds last changed.
    modifiedMs: number;

    // When it or what it holds last changed.
    changedMs: number;

    // When it was made.
    bornMs: number;
}

// One entry with the path it was found at, for a call that reports where something is.
export interface FoundEntry {
    // Where the entry sits, with every link on the way followed.
    path: string;

    // The entry itself, or none when no entry sits at that path.
    entry: Entry | undefined;

    // Whether a link was followed on the way.
    followedLink: boolean;
}

// One file opened with `open`, by the number it was handed back as.
interface OpenFile {
    // Where the file sits.
    path: string;

    // The file itself, so a file removed while open is still read.
    entry: Entry;

    // Where the next read or write starts.
    position: number;

    // Whether every write goes to the end, as the `a` flags ask.
    appending: boolean;

    // Whether the file was opened for reading.
    readable: boolean;

    // Whether it was opened for writing.
    writable: boolean;
}

// How many links Linux follows in one path before it fails with `ELOOP`.
const mostLinksFollowed = 40;

// The longest name of one entry Linux takes, in bytes.
const longestNameBytes = 255;

// The first number a file opened here is handed back as. The three below it are the standard
// streams, which a real process holds open.
const firstFileNumber = 3;

// The permission bits of a file made with no mode given: read and write for everybody, which is
// what Node asks for, with no umask taken off.
const fileMode = 0o666;

// The permission bits of a directory made with no mode given.
const directoryMode = 0o777;

// The type bits `stat` puts above the permission bits for each kind of entry.
export const typeBits: Record<EntryKind, number> = {
    file: 0o100000,
    directory: 0o040000,
    symlink: 0o120000,
};

// What a call that opens a file to read it can fail with.
const openToRead = ["file-not-found", "access-denied", "is-a-directory", "not-a-directory", "name-too-long", "symlink-loop", "too-many-open-files"];

// What a call that opens a file to write it can fail with, besides `already-exists`, which only a
// call that creates exclusively can.
const openToWrite = [...openToRead, "out-of-space", "read-only-filesystem"];

// What a call that checks a path can fail with.
const checkPath = ["file-not-found", "access-denied", "not-a-directory", "name-too-long", "symlink-loop"];

// What reading a file whole can fail with.
const readWhole = ["input-or-output-error", "read-of-a-directory"];

// What writing a file whole can fail with. A whole write writes again until everything is written,
// so a short write is not one of them.
const writeWhole = ["out-of-space", "input-or-output-error", "quota-exceeded", "read-only-filesystem"];

// What following a link on the way to a path can fail with.
const followLink = ["dangling-link", "link-loop"];

// What `readdir` can fail with. Only a directory read entry by entry can fail part way through.
const listWhole = ["open-a-missing-directory", "open-a-file-as-a-directory", "access-denied", "empty-directory", "too-many-open-files"];

// What deleting a file can fail with.
const deleteFile = ["file-not-found", "access-denied", "file-in-use", "is-a-directory", "read-only-filesystem"];

// What deleting an empty directory can fail with.
const deleteDirectory = ["file-not-found", "access-denied", "file-in-use", "not-a-directory", "directory-not-empty", "symlink-loop", "read-only-filesystem"];

// What a rename can fail with. A rename moves no bytes, so it cannot fail part way through.
const renameEntry = ["source-not-found", "access-denied", "destination-is-a-non-empty-directory", "destination-is-a-directory", "file-in-use", "across-filesystems", "out-of-space", "quota-exceeded", "read-only-filesystem"];

// What a copy can fail with.
const copyEntry = ["source-not-found", "access-denied", "destination-is-a-directory", "file-in-use", "out-of-space", "quota-exceeded", "read-only-filesystem", "copy-fails-part-way-through"];

// What making a link can fail with, besides `hard-link-across-filesystems`, which only a hard link
// can.
const makeLink = ["create-over-an-existing-path", "create-without-permission", "create-in-a-missing-directory", "out-of-space"];

// What changing a path's permissions, owner or times can fail with.
const changeAttributes = ["access-denied", "not-permitted", "file-not-found", "input-or-output-error", "read-only-filesystem", "symlink-loop"];

// What changing an open file's permissions, owner or times can fail with. The file is open, so it
// is there and no path is followed.
const changeOpenAttributes = ["access-denied", "not-permitted", "input-or-output-error", "read-only-filesystem"];

// The tree one run owns, and the files opened in it.
export class RunFiles {
    // Every entry, by its absolute path with no link in it.
    private readonly entries = new Map<string, Entry>();

    // Every file opened and not yet closed, by the number it was handed back as.
    private readonly open = new Map<number, OpenFile>();

    // The number the next file opened is handed back as.
    private nextFileNumber = firstFileNumber;

    // The number the next entry made is given.
    private nextInode = 1;

    // The directory a relative path is read from, as `process.cwd` reads it.
    private workingDirectory = "/";

    // What decides which operations go wrong.
    private readonly injector: Injector;

    // What stamps each entry with when it changed.
    private readonly clock: RunClock;

    // Where the names `mkdtemp` makes up are drawn from.
    private readonly rng: SeededRng;

    constructor(injector: Injector, clock: RunClock, rng: SeededRng) {
        this.injector = injector;
        this.clock = clock;
        this.rng = rng;
        this.entries.set("/", this.made("directory", directoryMode));
    }

    // A new entry, stamped with now.
    private made(kind: EntryKind, mode: number): Entry {
        const nowMs = this.clock.stampMs();
        const entry: Entry = {
            kind,
            bytes: Buffer.alloc(0),
            target: "",
            mode,
            inode: this.nextInode,
            userId: 0,
            groupId: 0,
            accessedMs: nowMs,
            modifiedMs: nowMs,
            changedMs: nowMs,
            bornMs: nowMs,
        };
        this.nextInode += 1;
        return entry;
    }

    // Asks the injector whether this operation fails, throws the error it asked for when that
    // failure fails with a code, and hands back any other failure for the operation to carry out.
    private ask(effect: Effect, possible: string[], syscall: string, at: string, dest?: string): string | undefined {
        const failure = this.injector.check(effect, possible);
        if (failure !== undefined && hasCode(failure)) {
            throw fileError(codeOf(failure), syscall, at, dest);
        }
        return failure;
    }

    // Asks whether following a link failed, for a path whose way to its entry followed one.
    private askLink(found: FoundEntry, syscall: string, at: string): void {
        if (!found.followedLink) {
            return;
        }
        const failure = this.injector.check("link", followLink);
        if (failure === "dangling-link") {
            throw fileError("ENOENT", syscall, at);
        }
        if (failure === "link-loop") {
            throw fileError("ELOOP", syscall, at);
        }
    }

    // The directory a relative path is read from.
    cwd(): string {
        const failure = this.injector.check("current-directory", ["current-directory-was-deleted"]);
        if (failure !== undefined) {
            throw fileError("ENOENT", "uv_cwd", this.workingDirectory);
        }
        return this.workingDirectory;
    }

    // Changes the directory a relative path is read from.
    chdir(to: string): void {
        const failure = this.injector.check("current-directory", ["change-to-a-missing-directory"]);
        const found = this.find(to, true, "chdir");
        if (failure !== undefined || found.entry === undefined) {
            throw fileError("ENOENT", "chdir", this.workingDirectory, to);
        }
        if (found.entry.kind !== "directory") {
            throw fileError("ENOTDIR", "chdir", this.workingDirectory, to);
        }
        this.workingDirectory = found.path;
    }

    // An absolute path for what a call was given, read from the working directory when relative.
    absolute(at: string): string {
        return path.posix.resolve(this.workingDirectory, at);
    }

    // Finds the entry a path names, following every link on the way and the last one too when
    // `followLast` is set, and fails as Linux fails when a directory on the way is missing, is not
    // a directory or the links loop.
    find(at: string, followLast: boolean, syscall: string): FoundEntry {
        const pending = this.absolute(at).split("/").filter((part) => part !== "").reverse();
        let current = "/";
        let followed = 0;
        while (pending.length > 0) {
            const part = pending.pop()!;
            if (Buffer.byteLength(part) > longestNameBytes) {
                throw fileError("ENAMETOOLONG", syscall, at);
            }
            if (part === ".") {
                continue;
            }
            if (part === "..") {
                current = path.posix.dirname(current);
                continue;
            }
            const next = path.posix.join(current, part);
            const entry = this.entries.get(next);
            const isLast = pending.length === 0;
            if (entry === undefined) {
                if (isLast) {
                    return {
                        path: next,
                        entry: undefined,
                        followedLink: followed > 0,
                    };
                }
                throw fileError("ENOENT", syscall, at);
            }
            if (entry.kind === "symlink" && (!isLast || followLast)) {
                followed += 1;
                if (followed > mostLinksFollowed) {
                    throw fileError("ELOOP", syscall, at);
                }
                const targetParts = entry.target.split("/").filter((piece) => piece !== "").reverse();
                pending.push(...targetParts);
                if (entry.target.startsWith("/")) {
                    current = "/";
                }
                continue;
            }
            if (entry.kind !== "directory" && !isLast) {
                throw fileError("ENOTDIR", syscall, at);
            }
            current = next;
        }
        return {
            path: current,
            entry: this.entries.get(current),
            followedLink: followed > 0,
        };
    }

    // Checks the directory a new entry at `found` goes in. `find` has already failed as Linux fails
    // for a directory on the way that is missing or is not a directory, so the parent is always a
    // directory here.
    private parentOf(found: FoundEntry): void {
        const parent = this.entries.get(path.posix.dirname(found.path));
        assert.ok(parent !== undefined);
        assert.equal(parent.kind, "directory");
    }

    // Every path directly inside a directory, in sorted order.
    private childrenOf(directory: string): string[] {
        const prefix = directory === "/" ? "/" : `${directory}/`;
        const children: string[] = [];
        for (const held of this.entries.keys()) {
            if (held !== directory && held.startsWith(prefix) && !held.slice(prefix.length).includes("/")) {
                children.push(held);
            }
        }
        return children.sort();
    }

    // How many paths hold one entry, which is what `stat` gives as its link count.
    linkCount(entry: Entry): number {
        let count = 0;
        for (const held of this.entries.values()) {
            if (held === entry) {
                count += 1;
            }
        }
        return count;
    }

    // Reads a file whole.
    readFile(at: string): Buffer {
        this.ask("file-open", openToRead, "open", at);
        const found = this.find(at, true, "open");
        this.askLink(found, "open", at);
        if (found.entry === undefined) {
            throw fileError("ENOENT", "open", at);
        }
        this.ask("read", readWhole, "read", at);
        if (found.entry.kind === "directory") {
            throw fileError("EISDIR", "read", at);
        }
        found.entry.accessedMs = this.clock.stampMs();
        return Buffer.from(found.entry.bytes);
    }

    // Writes a file whole, replacing what it held, or adds to its end when `appending`. A call that
    // creates exclusively fails when the file is there.
    writeFile(at: string, bytes: Buffer, appending: boolean, exclusive: boolean): void {
        this.ask("file-open", exclusive ? [...openToWrite, "already-exists"] : openToWrite, "open", at);
        const entry = this.openForWriting(at, exclusive, fileMode);
        this.ask("write", writeWhole, "write", at);
        entry.bytes = appending ? Buffer.concat([entry.bytes, bytes]) : Buffer.from(bytes);
        this.touch(entry);
    }

    // The file a write goes to, made when it is not there.
    private openForWriting(at: string, exclusive: boolean, mode: number): Entry {
        const found = this.find(at, true, "open");
        this.askLink(found, "open", at);
        if (found.entry !== undefined) {
            if (exclusive) {
                throw fileError("EEXIST", "open", at);
            }
            if (found.entry.kind === "directory") {
                throw fileError("EISDIR", "open", at);
            }
            return found.entry;
        }
        this.parentOf(found);
        const entry = this.made("file", mode);
        this.entries.set(found.path, entry);
        return entry;
    }

    // Stamps an entry as changed now.
    private touch(entry: Entry): void {
        const nowMs = this.clock.stampMs();
        entry.modifiedMs = nowMs;
        entry.changedMs = nowMs;
    }

    // What one path is, following a link at the end of it when `followLast` is set.
    stat(at: string, followLast: boolean): FoundEntry {
        const syscall = followLast ? "stat" : "lstat";
        this.ask("file-open", checkPath, syscall, at);
        const found = this.find(at, followLast, syscall);
        this.askLink(found, syscall, at);
        if (found.entry === undefined) {
            throw fileError("ENOENT", syscall, at);
        }
        return found;
    }

    // Whether a path is there, as `existsSync` asks. Any failure answers no, as Node answers it.
    exists(at: string): boolean {
        try {
            this.stat(at, true);
        }
        catch {
            return false;
        }
        return true;
    }

    // What one directory holds, as paths in sorted order. A listing that goes into every
    // directory below lists each directory's entries before the next directory's.
    listDirectory(at: string, recursive: boolean): string[] {
        const failure = this.ask("directory-listing", listWhole, "scandir", at);
        const directory = this.directoryAt(at, "scandir");
        if (failure === "empty-directory") {
            return [];
        }
        if (!recursive) {
            return this.childrenOf(directory);
        }
        const listed: string[] = [];
        const waiting = [directory];
        while (waiting.length > 0) {
            const next = waiting.shift()!;
            for (const child of this.childrenOf(next)) {
                listed.push(child);
                if (this.entries.get(child)!.kind === "directory") {
                    waiting.push(child);
                }
            }
        }
        return listed;
    }

    // The directory a path names, failing as Node fails when it is missing or is not one.
    private directoryAt(at: string, syscall: string): string {
        const found = this.find(at, true, syscall);
        this.askLink(found, syscall, at);
        if (found.entry === undefined) {
            throw fileError("ENOENT", syscall, at);
        }
        if (found.entry.kind !== "directory") {
            throw fileError("ENOTDIR", syscall, at);
        }
        return found.path;
    }

    // Opens a directory to read entry by entry, as `opendir` does, and hands back its entries and
    // how many of them are read before the listing fails part way through, or none when it does not.
    openDirectory(at: string): { paths: string[]; failsAfter: number | undefined } {
        const failure = this.ask("directory-listing", [...listWhole, "error-part-way-through-the-listing"], "opendir", at);
        const directory = this.directoryAt(at, "opendir");
        if (failure === "empty-directory") {
            return {
                paths: [],
                failsAfter: undefined,
            };
        }
        const paths = this.childrenOf(directory);
        return {
            paths,
            failsAfter: failure === "error-part-way-through-the-listing" ? Math.ceil(paths.length / 2) : undefined,
        };
    }

    // Makes a directory, and every missing one above it when `recursive` is set. It hands back the
    // first directory it made, as Node's recursive `mkdir` does, or none when it made none.
    makeDirectory(at: string, recursive: boolean, mode: number): string | undefined {
        const possible = recursive
            ? ["access-denied", "parent-is-not-a-directory", "out-of-space", "quota-exceeded", "read-only-filesystem"]
            : ["already-exists", "access-denied", "parent-directory-missing", "parent-is-not-a-directory", "out-of-space", "quota-exceeded", "read-only-filesystem"];
        this.ask("make-directory", possible, "mkdir", at);
        if (!recursive) {
            const found = this.find(at, false, "mkdir");
            if (found.entry !== undefined) {
                throw fileError("EEXIST", "mkdir", at);
            }
            this.parentOf(found);
            this.entries.set(found.path, this.made("directory", mode));
            return found.path;
        }
        let firstMade: string | undefined;
        let current = "/";
        for (const part of this.absolute(at).split("/").filter((piece) => piece !== "")) {
            const found = this.find(path.posix.join(current, part), true, "mkdir");
            if (found.entry === undefined) {
                this.entries.set(found.path, this.made("directory", mode));
                firstMade = firstMade ?? found.path;
            }
            else if (found.entry.kind !== "directory") {
                throw fileError(found.path === this.absolute(at) ? "EEXIST" : "ENOTDIR", "mkdir", at);
            }
            current = found.path;
        }
        return firstMade;
    }

    // Makes a new directory whose name is `prefix` followed by six characters drawn from the run's
    // generator, as `mkdtemp` does, and hands back its path.
    makeTemporaryDirectory(prefix: string): string {
        this.ask("make-directory", ["access-denied", "parent-directory-missing", "parent-is-not-a-directory", "out-of-space", "quota-exceeded", "read-only-filesystem"], "mkdtemp", `${prefix}XXXXXX`);
        // The letters and digits Node's own `mkdtemp` draws its names from.
        const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let name = prefix;
        for (let index = 0; index < 6; index += 1) {
            name += letters[this.rng.int(0, letters.length - 1)];
        }
        const found = this.find(name, false, "mkdtemp");
        this.parentOf(found);
        this.entries.set(found.path, this.made("directory", 0o700));
        return name;
    }

    // Removes a file or a link, as `unlink` does. A link goes and what it points at stays.
    unlink(at: string): void {
        const found = this.find(at, false, "unlink");
        if (found.entry !== undefined && found.entry.kind === "symlink") {
            this.ask("link", ["remove-a-link-that-is-missing"], "unlink", at);
        }
        else {
            this.ask("delete", deleteFile, "unlink", at);
        }
        if (found.entry === undefined) {
            throw fileError("ENOENT", "unlink", at);
        }
        if (found.entry.kind === "directory") {
            throw fileError("EISDIR", "unlink", at);
        }
        this.entries.delete(found.path);
    }

    // Removes an empty directory, as `rmdir` does.
    removeDirectory(at: string): void {
        this.ask("delete", deleteDirectory, "rmdir", at);
        const found = this.find(at, false, "rmdir");
        if (found.entry === undefined) {
            throw fileError("ENOENT", "rmdir", at);
        }
        if (found.entry.kind !== "directory") {
            throw fileError("ENOTDIR", "rmdir", at);
        }
        if (this.childrenOf(found.path).length > 0) {
            throw fileError("ENOTEMPTY", "rmdir", at);
        }
        this.entries.delete(found.path);
    }

    // Removes a path, and everything under it when `recursive` is set, as `rm` does. With `force`
    // a path that is not there is no failure.
    remove(at: string, recursive: boolean, force: boolean): void {
        const possible = ["access-denied", "file-in-use", "symlink-loop", "read-only-filesystem"];
        if (!force) {
            possible.unshift("file-not-found");
        }
        if (recursive) {
            possible.push("error-part-way-through-deleting-a-tree");
        }
        const failure = this.ask("delete", possible, "rm", at);
        const found = this.find(at, false, "rm");
        if (found.entry === undefined) {
            if (force) {
                return;
            }
            throw fileError("ENOENT", "rm", at);
        }
        if (found.entry.kind !== "directory") {
            this.entries.delete(found.path);
            return;
        }
        if (!recursive) {
            throw fileError("EISDIR", "rm", at);
        }
        // Everything under the directory, deepest first, so each directory is empty when it goes.
        const under = [...this.entries.keys()].filter((held) => held.startsWith(`${found.path}/`)).sort().reverse();
        under.push(found.path);
        let deleted = 0;
        for (const held of under) {
            if (failure === "error-part-way-through-deleting-a-tree" && deleted > 0) {
                throw fileError("EIO", "rm", held);
            }
            this.entries.delete(held);
            deleted += 1;
        }
        if (failure === "error-part-way-through-deleting-a-tree") {
            // A tree of one entry has no later entry to fail on, so the failure comes after it.
            throw fileError("EIO", "rm", at);
        }
    }

    // Moves an entry from one path to another, replacing a file or an empty directory there.
    rename(from: string, to: string): void {
        this.ask("rename-copy", renameEntry, "rename", from, to);
        const source = this.find(from, false, "rename");
        if (source.entry === undefined) {
            throw fileError("ENOENT", "rename", from, to);
        }
        const destination = this.find(to, false, "rename");
        this.parentOf(destination);
        if (destination.entry !== undefined && destination.entry.kind === "directory") {
            if (source.entry.kind !== "directory") {
                throw fileError("EISDIR", "rename", from, to);
            }
            if (this.childrenOf(destination.path).length > 0) {
                throw fileError("ENOTEMPTY", "rename", from, to);
            }
        }
        if (destination.path.startsWith(`${source.path}/`)) {
            throw fileError("EINVAL", "rename", from, to);
        }
        const moving = [...this.entries.keys()].filter((held) => held === source.path || held.startsWith(`${source.path}/`));
        for (const held of moving) {
            const entry = this.entries.get(held)!;
            this.entries.delete(held);
            this.entries.set(destination.path + held.slice(source.path.length), entry);
        }
    }

    // Copies one file to another path, as `copyFile` does. A copy that fails part way through
    // leaves the first half of the bytes at the destination.
    copyFile(from: string, to: string, exclusive: boolean): void {
        const failure = this.ask("rename-copy", copyEntry, "copyfile", from, to);
        const source = this.find(from, true, "copyfile");
        if (source.entry === undefined) {
            throw fileError("ENOENT", "copyfile", from, to);
        }
        if (source.entry.kind === "directory") {
            throw fileError("EISDIR", "copyfile", from, to);
        }
        const destination = this.find(to, true, "copyfile");
        if (destination.entry !== undefined && exclusive) {
            throw fileError("EEXIST", "copyfile", from, to);
        }
        if (destination.entry !== undefined && destination.entry.kind === "directory") {
            throw fileError("EISDIR", "copyfile", from, to);
        }
        this.parentOf(destination);
        const entry = destination.entry ?? this.made("file", source.entry.mode);
        this.entries.set(destination.path, entry);
        if (failure === "copy-fails-part-way-through") {
            entry.bytes = Buffer.from(source.entry.bytes.subarray(0, Math.floor(source.entry.bytes.length / 2)));
            this.touch(entry);
            throw fileError("EIO", "copyfile", from, to);
        }
        entry.bytes = Buffer.from(source.entry.bytes);
        this.touch(entry);
    }

    // Copies a file, or a directory and everything under it when `recursive` is set, as `cp` does.
    copyTree(from: string, to: string, recursive: boolean): void {
        const source = this.find(from, true, "cp");
        if (source.entry === undefined || source.entry.kind !== "directory") {
            this.copyFile(from, to, false);
            return;
        }
        if (!recursive) {
            throw fileError("EISDIR", "cp", from, to);
        }
        this.makeDirectory(to, true, source.entry.mode);
        for (const child of this.childrenOf(source.path)) {
            const name = path.posix.basename(child);
            this.copyTree(child, path.posix.join(this.absolute(to), name), true);
        }
    }

    // Makes a symbolic link at `at` that points at `target`.
    symlink(target: string, at: string): void {
        this.ask("link", makeLink, "symlink", target, at);
        const found = this.find(at, false, "symlink");
        if (found.entry !== undefined) {
            throw fileError("EEXIST", "symlink", target, at);
        }
        this.parentOf(found);
        const entry = this.made("symlink", 0o777);
        entry.target = target;
        this.entries.set(found.path, entry);
    }

    // Makes a hard link at `at` to the file at `existing`, so both paths hold one file.
    link(existing: string, at: string): void {
        this.ask("link", [...makeLink, "hard-link-across-filesystems"], "link", existing, at);
        const source = this.find(existing, false, "link");
        if (source.entry === undefined) {
            throw fileError("ENOENT", "link", existing, at);
        }
        if (source.entry.kind === "directory") {
            throw fileError("EPERM", "link", existing, at);
        }
        const found = this.find(at, false, "link");
        if (found.entry !== undefined) {
            throw fileError("EEXIST", "link", existing, at);
        }
        this.parentOf(found);
        this.entries.set(found.path, source.entry);
    }

    // Where a link points, as it was written.
    readLink(at: string): string {
        this.ask("link", ["read-a-link-that-is-not-a-link", "read-a-link-that-is-missing"], "readlink", at);
        const found = this.find(at, false, "readlink");
        if (found.entry === undefined) {
            throw fileError("ENOENT", "readlink", at);
        }
        if (found.entry.kind !== "symlink") {
            throw fileError("EINVAL", "readlink", at);
        }
        return found.entry.target;
    }

    // The path an entry sits at with every link followed, as `realpath` gives it.
    realPath(at: string): string {
        this.ask("resolve-path", ["path-not-found", "not-a-directory", "access-denied", "symlink-loop", "name-too-long"], "realpath", at);
        const found = this.find(at, true, "realpath");
        if (found.entry === undefined) {
            throw fileError("ENOENT", "realpath", at);
        }
        return found.path;
    }

    // Changes the permission bits, the owner or the times of a path. `change` makes the change to
    // the entry the path names.
    changeAttributes(at: string, followLast: boolean, syscall: string, change: (entry: Entry) => void): void {
        this.ask("attributes", changeAttributes, syscall, at);
        const found = this.find(at, followLast, syscall);
        if (found.entry === undefined) {
            throw fileError("ENOENT", syscall, at);
        }
        change(found.entry);
        found.entry.changedMs = this.clock.stampMs();
    }

    // Sets a file's length, cutting it short or filling it with zero bytes.
    truncate(at: string, length: number): void {
        this.ask("file-state", ["resize-past-the-size-limit"], "open", at);
        const found = this.find(at, true, "open");
        if (found.entry === undefined) {
            throw fileError("ENOENT", "open", at);
        }
        if (found.entry.kind === "directory") {
            throw fileError("EISDIR", "open", at);
        }
        this.resize(found.entry, length);
    }

    // Cuts a file short or fills it with zero bytes to the length asked for.
    private resize(entry: Entry, length: number): void {
        const resized = Buffer.alloc(Math.max(0, length));
        entry.bytes.copy(resized, 0, 0, Math.min(entry.bytes.length, resized.length));
        entry.bytes = resized;
        this.touch(entry);
    }

    // Opens a file and hands back the number it is held by, as `open` does with the flags Node
    // takes as letters: `r`, `r+`, `w`, `w+`, `wx`, `a`, `a+`, `ax` and the rest.
    openFile(at: string, flags: string, mode: number): number {
        const readable = flags.startsWith("r") || flags.includes("+");
        const writable = !flags.startsWith("r") || flags.includes("+");
        const exclusive = flags.includes("x");
        const possible = writable ? (exclusive ? [...openToWrite, "already-exists"] : openToWrite) : openToRead;
        this.ask("file-open", possible, "open", at);
        let entry: Entry;
        if (flags.startsWith("r")) {
            const found = this.find(at, true, "open");
            this.askLink(found, "open", at);
            if (found.entry === undefined) {
                throw fileError("ENOENT", "open", at);
            }
            if (found.entry.kind === "directory" && writable) {
                throw fileError("EISDIR", "open", at);
            }
            entry = found.entry;
        }
        else {
            entry = this.openForWriting(at, exclusive, mode);
            if (flags.startsWith("w")) {
                entry.bytes = Buffer.alloc(0);
                this.touch(entry);
            }
        }
        const number = this.nextFileNumber;
        this.nextFileNumber += 1;
        this.open.set(number, {
            path: this.absolute(at),
            entry,
            position: 0,
            appending: flags.startsWith("a"),
            readable,
            writable,
        });
        return number;
    }

    // The file a number holds, failing with `EBADF` for a number no open file has.
    private opened(number: number, syscall: string): OpenFile {
        const held = this.open.get(number);
        if (held === undefined) {
            throw badFileError(syscall);
        }
        return held;
    }

    // The path an open file was opened at, for an error about it.
    openedPath(number: number): string {
        return this.opened(number, "fstat").path;
    }

    // Reads up to `length` bytes of an open file into `into` at `offset`, from `position` or from
    // where the last read ended, and hands back how many it read. A short read reads half of what
    // was asked for and leaves the rest for the next read.
    readOpen(number: number, into: Uint8Array, offset: number, length: number, position: number | undefined): number {
        const held = this.opened(number, "read");
        const failure = this.ask("read", ["input-or-output-error", "short-read", "read-of-a-directory"], "read", held.path);
        if (held.entry.kind === "directory") {
            throw fileError("EISDIR", "read", held.path);
        }
        if (!held.readable) {
            throw badFileError("read");
        }
        const start = position ?? held.position;
        const wanted = failure === "short-read" ? Math.max(1, Math.floor(length / 2)) : length;
        const available = Math.max(0, Math.min(wanted, held.entry.bytes.length - start));
        held.entry.bytes.copy(into, offset, start, start + available);
        if (position === undefined) {
            held.position = start + available;
        }
        held.entry.accessedMs = this.clock.stampMs();
        return available;
    }

    // Writes `bytes` to an open file at `position`, or where the last write ended, or at the end
    // for a file opened to append, and hands back how many it took. A short write takes half.
    writeOpen(number: number, bytes: Uint8Array, position: number | undefined): number {
        const held = this.opened(number, "write");
        const possible = ["out-of-space", "input-or-output-error", "quota-exceeded", "read-only-filesystem"];
        if (bytes.length > 1) {
            possible.splice(2, 0, "short-write");
        }
        const failure = this.ask("write", possible, "write", held.path);
        if (!held.writable) {
            throw badFileError("write");
        }
        const taken = failure === "short-write" ? Math.floor(bytes.length / 2) : bytes.length;
        const start = held.appending ? held.entry.bytes.length : (position ?? held.position);
        const end = start + taken;
        if (end > held.entry.bytes.length) {
            const grown = Buffer.alloc(end);
            held.entry.bytes.copy(grown);
            held.entry.bytes = grown;
        }
        Buffer.from(bytes.buffer, bytes.byteOffset, taken).copy(held.entry.bytes, start);
        if (position === undefined || held.appending) {
            held.position = end;
        }
        this.touch(held.entry);
        return taken;
    }

    // Reads an open file for a read stream, from `start` up to and including `end` or to the end of
    // the file. A stream that ends early hands over only the first half.
    readForStream(number: number, start: number, end: number | undefined): Buffer {
        const held = this.opened(number, "read");
        const failure = this.ask("read", ["input-or-output-error", "early-end-of-stream", "read-of-a-directory"], "read", held.path);
        if (held.entry.kind === "directory") {
            throw fileError("EISDIR", "read", held.path);
        }
        const bytes = held.entry.bytes.subarray(start, end === undefined ? undefined : end + 1);
        held.entry.accessedMs = this.clock.stampMs();
        if (failure === "early-end-of-stream") {
            return Buffer.from(bytes.subarray(0, Math.floor(bytes.length / 2)));
        }
        return Buffer.from(bytes);
    }

    // What sits at an absolute path with no link in it, without asking the injector, for a listing
    // that names what each of its entries is. The listing was the call, so this is not a place.
    kindAt(at: string): EntryKind | undefined {
        return this.entries.get(at)?.kind;
    }

    // What an open file is, as `fstat` gives it.
    statOpen(number: number): FoundEntry {
        const held = this.opened(number, "fstat");
        this.ask("file-state", ["length-cannot-be-read"], "fstat", held.path);
        return {
            path: held.path,
            entry: held.entry,
            followedLink: false,
        };
    }

    // Sets an open file's length.
    truncateOpen(number: number, length: number): void {
        const held = this.opened(number, "ftruncate");
        this.ask("file-state", ["resize-past-the-size-limit"], "ftruncate", held.path);
        this.resize(held.entry, length);
    }

    // Writes an open file's contents through to the disk, which in memory moves nothing.
    syncOpen(number: number, syscall: string): void {
        const held = this.opened(number, syscall);
        this.ask("file-state", ["sync-fails", "sync-out-of-space"], syscall, held.path);
    }

    // Changes the permission bits, the owner or the times of an open file.
    changeOpenAttributes(number: number, syscall: string, change: (entry: Entry) => void): void {
        const held = this.opened(number, syscall);
        this.ask("attributes", changeOpenAttributes, syscall, held.path);
        change(held.entry);
        held.entry.changedMs = this.clock.stampMs();
    }

    // Closes an open file.
    closeOpen(number: number): void {
        this.opened(number, "close");
        this.open.delete(number);
    }
}

// The error Node gives a call made with a number no open file has.
function badFileError(syscall: string): CodedError {
    return new CodedError("EBADF", `EBADF: bad file descriptor, ${syscall}`, syscall);
}
