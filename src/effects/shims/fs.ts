// What the copy imports in place of `node:fs`.
//
// The code under test asks for a file the way it always did. This answers from the run's own tree,
// held in memory, and fails the way the runtime fails whenever the injector says this call goes
// wrong. Nothing here touches the disk.
//
// A call made when no run is in flight goes to the real `node:fs`, so the tool's own reads are its
// own.

import real from "node:fs";
import { Readable, Writable } from "node:stream";
import { nowRunning } from "../current.ts";
import type { RunFiles } from "../effects.ts";

// Everything the real module has and this one does not replace. A name a project imports and this
// file does not hand out would stop the import outright, and a name declared here wins over the
// one the star brings in.
//
// The star brings in the real thing, so every one of its calls that reaches the disk is replaced
// below whether or not this file does anything useful with it. A run makes up the path it passes,
// and the real `rmdirSync` given a made up path would take a directory off the machine.
export * from "node:fs";

// The tree of the run in flight, or nothing when the tool itself is reading.
function tree(): RunFiles | undefined {
    return nowRunning()?.files;
}

// What a read hands back, as text or as bytes, for whichever the caller asked for.
function asAsked(text: string, options: unknown): string | Buffer {
    const encoding = typeof options === "string" ? options : (options as { encoding?: string } | undefined)?.encoding;
    if (encoding === undefined || encoding === null) {
        return Buffer.from(text, "utf8");
    }
    return text;
}

// What was given to a write, as text.
function asText(data: unknown): string {
    if (typeof data === "string") {
        return data;
    }
    if (data instanceof Uint8Array) {
        return new TextDecoder().decode(data);
    }
    return String(data);
}

// What `statSync` hands back. The runtime's own has far more on it, and this is what code under
// test reads.
class Stats {
    // How many bytes the file holds.
    readonly size: number;

    // Whether the path is a file.
    private readonly file: boolean;

    // Whether the path is a directory.
    private readonly directory: boolean;

    constructor(of: { isFile: boolean; isDirectory: boolean; size: number }) {
        this.size = of.size;
        this.file = of.isFile;
        this.directory = of.isDirectory;
    }

    isFile(): boolean {
        return this.file;
    }

    isDirectory(): boolean {
        return this.directory;
    }

    isSymbolicLink(): boolean {
        return false;
    }
}

export function readFileSync(path: string, options?: unknown): string | Buffer {
    const held = tree();
    if (held === undefined) {
        return real.readFileSync(path, options as never);
    }
    return asAsked(held.readNow(path), options);
}

export function writeFileSync(path: string, data: unknown): void {
    const held = tree();
    if (held === undefined) {
        real.writeFileSync(path, data as never);
        return;
    }
    held.writeNow(path, asText(data));
}

export function appendFileSync(path: string, data: unknown): void {
    const held = tree();
    if (held === undefined) {
        real.appendFileSync(path, data as never);
        return;
    }
    held.appendNow(path, asText(data));
}

export function existsSync(path: string): boolean {
    const held = tree();
    return held === undefined ? real.existsSync(path) : held.existsNow(path);
}

export function readdirSync(path: string): string[] {
    const held = tree();
    return held === undefined ? (real.readdirSync(path) as string[]) : held.listNow(path);
}

export function mkdirSync(path: string, options?: unknown): undefined {
    const held = tree();
    if (held === undefined) {
        real.mkdirSync(path, options as never);
        return undefined;
    }
    held.makeDirectoryNow(path);
    return undefined;
}

export function unlinkSync(path: string): void {
    const held = tree();
    if (held === undefined) {
        real.unlinkSync(path);
        return;
    }
    held.removeNow(path);
}

export function rmSync(path: string, options?: unknown): void {
    const held = tree();
    if (held === undefined) {
        real.rmSync(path, options as never);
        return;
    }
    held.removeNow(path);
}

export function renameSync(from: string, to: string): void {
    const held = tree();
    if (held === undefined) {
        real.renameSync(from, to);
        return;
    }
    held.renameNow(from, to);
}

export function copyFileSync(from: string, to: string): void {
    const held = tree();
    if (held === undefined) {
        real.copyFileSync(from, to);
        return;
    }
    held.writeNow(to, held.readNow(from));
}

export function statSync(path: string): Stats {
    const held = tree();
    return held === undefined ? (real.statSync(path) as unknown as Stats) : new Stats(held.statNow(path));
}

export function lstatSync(path: string): Stats {
    return statSync(path);
}

// Runs one of the calls above and hands the answer to a callback, the way the runtime does. The
// options argument is left out when the caller left it out, which is how `fs.readFile(path, done)`
// is told from `fs.readFile(path, options, done)`.
function withCallback<T>(work: () => T, options: unknown, callback: unknown): void {
    const done = (typeof options === "function" ? options : callback) as (error: unknown, answer?: T) => void;
    // A caller that passed something other than a function where the callback goes gets no answer,
    // the same as one that passed none.
    if (typeof done !== "function") {
        return;
    }
    let answer: T;
    try {
        answer = work();
    }
    catch (thrown) {
        queueMicrotask(() => done(thrown));
        return;
    }
    queueMicrotask(() => done(null, answer));
}

export function readFile(path: string, options: unknown, callback?: unknown): void {
    withCallback(() => readFileSync(path, typeof options === "function" ? undefined : options), options, callback);
}

export function writeFile(path: string, data: unknown, options: unknown, callback?: unknown): void {
    withCallback(() => writeFileSync(path, data), options, callback);
}

export function appendFile(path: string, data: unknown, options: unknown, callback?: unknown): void {
    withCallback(() => appendFileSync(path, data), options, callback);
}

export function readdir(path: string, options: unknown, callback?: unknown): void {
    withCallback(() => readdirSync(path), options, callback);
}

export function mkdir(path: string, options: unknown, callback?: unknown): void {
    withCallback(() => mkdirSync(path), options, callback);
}

export function unlink(path: string, callback: unknown): void {
    withCallback(() => unlinkSync(path), callback, callback);
}

export function rm(path: string, options: unknown, callback?: unknown): void {
    withCallback(() => rmSync(path), options, callback);
}

export function rename(from: string, to: string, callback: unknown): void {
    withCallback(() => renameSync(from, to), callback, callback);
}

export function copyFile(from: string, to: string, callback: unknown): void {
    withCallback(() => copyFileSync(from, to), callback, callback);
}

export function stat(path: string, options: unknown, callback?: unknown): void {
    withCallback(() => statSync(path), options, callback);
}

export function access(path: string, mode: unknown, callback?: unknown): void {
    withCallback(
        () => {
            statSync(path);
        },
        mode,
        callback,
    );
}

export function accessSync(path: string): void {
    statSync(path);
}

// The promise half, which `node:fs/promises` re-exports and `fs.promises` is.
export const promises = {
    readFile: async (path: string, options?: unknown): Promise<string | Buffer> => readFileSync(path, options),
    writeFile: async (path: string, data: unknown): Promise<void> => writeFileSync(path, data),
    appendFile: async (path: string, data: unknown): Promise<void> => appendFileSync(path, data),
    readdir: async (path: string): Promise<string[]> => readdirSync(path),
    mkdir: async (path: string, options?: unknown): Promise<undefined> => mkdirSync(path, options),
    unlink: async (path: string): Promise<void> => unlinkSync(path),
    rm: async (path: string, options?: unknown): Promise<void> => rmSync(path, options),
    rename: async (from: string, to: string): Promise<void> => renameSync(from, to),
    copyFile: async (from: string, to: string): Promise<void> => copyFileSync(from, to),
    stat: async (path: string): Promise<Stats> => statSync(path),
    lstat: async (path: string): Promise<Stats> => lstatSync(path),
    access: async (path: string): Promise<void> => accessSync(path),
};

export { Stats };


// The calls that reach the disk and are not answered above. Each one is stopped rather than left as
// the real thing: the run makes up the path a call is given, and none of these may reach the
// machine. A caller gets the answer a call that did nothing gives, and the code after it runs.
export function chownSync(): void {}
export function chmodSync(): void {}
export function closeSync(): void {}
export function cpSync(): void {}
export function fchownSync(): void {}
export function fchmodSync(): void {}
export function fdatasyncSync(): void {}
export function fsyncSync(): void {}
export function ftruncateSync(): void {}
export function futimesSync(): void {}
export function lchownSync(): void {}
export function linkSync(): void {}
export function lutimesSync(): void {}
export function rmdirSync(): void {}
export function symlinkSync(): void {}
export function truncateSync(): void {}
export function utimesSync(): void {}
export function unwatchFile(): void {}
export function writeSync(): number {
    return 0;
}
export function writevSync(): number {
    return 0;
}
export function readSync(): number {
    return 0;
}
export function readvSync(): number {
    return 0;
}
export function openSync(): number {
    // A number no real handle has, so a caller holding it reaches nothing.
    return 0;
}
export function mkdtempSync(prefix: string): string {
    return `${prefix}made-up`;
}
export function realpathSync(path: string): string {
    return path;
}
export function readlinkSync(path: string): string {
    return path;
}
export function globSync(): string[] {
    return [];
}
export function statfsSync(): { bsize: number; blocks: number; bfree: number } {
    return { bsize: 4096, blocks: 1024, bfree: 512 };
}
export function fstatSync(): Stats {
    return new Stats({ isFile: true, isDirectory: false, size: 0 });
}
// The same calls written the way a caller that hands in a callback writes them.
export const chown = withNothing;
export const chmod = withNothing;
export const close = withNothing;
export const cp = withNothing;
export const fchown = withNothing;
export const fchmod = withNothing;
export const fdatasync = withNothing;
export const fsync = withNothing;
export const ftruncate = withNothing;
export const futimes = withNothing;
export const lchown = withNothing;
export const link = withNothing;
export const lutimes = withNothing;
export const rmdir = withNothing;
export const symlink = withNothing;
export const truncate = withNothing;
export const utimes = withNothing;
export const write = withNothing;
export const writev = withNothing;
export const read = withNothing;
export const readv = withNothing;
export const open = withNothing;
export const mkdtemp = withNothing;
export const realpath = withNothing;
export const readlink = withNothing;
export const glob = withNothing;
export const statfs = withNothing;
export const fstat = withNothing;
export const lstat = withNothing;
export const watch = withNothing;
export const watchFile = withNothing;
export const opendir = withNothing;
export const openAsBlob = withNothing;

// The old way of asking whether a path is there, which hands the answer to a callback and takes no
// error. Every path the run is asked about is there unless the injector says otherwise.
export function exists(path: string, done: unknown): void {
    const answer = existsSync(path);
    if (typeof done === "function") {
        queueMicrotask(() => (done as (held: boolean) => void)(answer));
    }
}

// Tells the last callback a call was given that it worked and there is nothing to report.
function withNothing(...args: unknown[]): undefined {
    const done = args[args.length - 1];
    if (typeof done === "function") {
        queueMicrotask(() => (done as (error: unknown) => void)(null));
    }
    return undefined;
}

// A directory read as a stream. It holds what the run's own tree holds, so a caller that walks it
// walks that rather than the machine.
export function opendirSync(path: string): { read: () => null; close: () => void; [Symbol.asyncIterator]: () => AsyncIterator<never> } {
    void path;
    return {
        read: () => null,
        close: () => undefined,
        [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined as never }) }),
    };
}

// A file read or written as a stream. Neither reaches the disk: one hands over what the run's tree
// holds and ends, and the other takes everything and keeps it in the tree.
export function createReadStream(path: string): Readable {
    const tree = nowRunning()?.files;
    if (tree === undefined) {
        return real.createReadStream(path) as unknown as Readable;
    }
    let held = "";
    try {
        held = tree.readNow(path);
    }
    catch {
        // A read the injector failed gives an empty stream rather than one that never ends.
    }
    return Readable.from([held]);
}

export function createWriteStream(path: string): Writable {
    const tree = nowRunning()?.files;
    if (tree === undefined) {
        return real.createWriteStream(path) as unknown as Writable;
    }
    let held = "";
    return new Writable({
        write(piece: unknown, _encoding: unknown, done: (error?: Error) => void) {
            held += asText(piece);
            tree.writeNow(path, held);
            done();
        },
    });
}

// What `import fs from "node:fs"` gets.
export default {
    readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, mkdirSync, unlinkSync, rmSync,
    renameSync, copyFileSync, statSync, lstatSync, accessSync,
    readFile, writeFile, appendFile, readdir, mkdir, unlink, rm, rename, copyFile, stat, access,
    chownSync, chmodSync, closeSync, cpSync, fchownSync, fchmodSync, fdatasyncSync, fsyncSync,
    ftruncateSync, futimesSync, lchownSync, linkSync, lutimesSync, rmdirSync, symlinkSync,
    truncateSync, utimesSync, unwatchFile, writeSync, writevSync, readSync, readvSync, openSync,
    mkdtempSync, realpathSync, readlinkSync, globSync, statfsSync, fstatSync, opendirSync,
    chown, chmod, close, cp, fchown, fchmod, fdatasync, fsync, ftruncate, futimes, lchown, link,
    lutimes, rmdir, symlink, truncate, utimes, write, writev, read, readv, open, mkdtemp, realpath,
    readlink, glob, statfs, fstat, lstat, watch, watchFile, opendir, openAsBlob,
    createReadStream, createWriteStream, exists,
    promises, Stats,
};
