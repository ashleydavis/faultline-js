//
// What the copy imports in place of `node:fs`.
//
// The code under test asks for a file the way it always did. This answers from the tree in memory
// of the run in flight, in the synchronous, callback and promise forms alike. A call fails the way
// Node fails it whenever the injector says the call goes wrong. No call made while a run is in
// flight reaches the disk.
//
// A synchronous call made with no run in flight is a mistake in the tool and crashes, because the
// disk could answer it only through a synchronous call to Node, which blocks the process. A
// callback, promise, stream or watch call made with no run in flight goes to the real `node:fs`,
// whose calls of those forms do not block.
//
// The calls here throw, reject or call back with an error when they fail, because that is how the
// API they stand in for tells the code under test about a failure.
//

import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import { EventEmitter } from "node:events";
import real from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isCodedError } from "../../lib/file-system.ts";
import { nowRunning } from "../current.ts";
import { abortError, fileError } from "../effects.ts";
import { RunFiles, typeBits, type Entry, type EntryKind, type FoundEntry } from "../filesystem.ts";
import { isAborted } from "../network.ts";

//
// The permission bits a file is made with when the call gives none, which Node asks for.
//
export const fileModeDefault = 0o666;

//
// The permission bits a directory is made with when the call gives none, which Node asks for.
//
export const directoryModeDefault = 0o777;

//
// The bits of a mode `chmod` sets: the permissions with the set-user, set-group and sticky bits
// above them. The type bits above those are the entry's own and are never changed.
//
export const changeableModeBits = 0o7777;

//
// A call of the API stood in for, as this module makes and hands on its calls. The code under test
// passes whatever it likes, so each argument is checked where it is used.
//
export type ApiCall = (...args: unknown[]) => unknown;

//
// A promise form of a call, as `fs.promises` holds them.
//
export type PromiseCall = (...args: unknown[]) => Promise<unknown>;

//
// What a callback form hands its callback after the error, worked out from what the synchronous
// form handed back and the arguments it was given.
//
export type CallbackAnswer = (answer: unknown, args: unknown[]) => unknown[];

//
// Whether a value is a function this module can call with the arguments it was given.
//
export function isApiCall(value: unknown): value is ApiCall {
    return typeof value === "function";
}

//
// Whether a value is an object whose properties are read by name, as an options object is.
//
export function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object") {
        return false;
    }
    return value !== null;
}

//
// Whether a value is a list, as a gathered read or write and a search for more than one pattern
// are given.
//
export function isList(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

//
// Whether a value names an encoding Node reads and writes text in.
//
export function isEncoding(value: unknown): value is BufferEncoding {
    if (typeof value !== "string") {
        return false;
    }
    return Buffer.isEncoding(value);
}

//
// Whether a value can be read with `for await`, as what the real promise `glob` and `watch` hand
// back can.
//
export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
    if (!isRecord(value)) {
        return false;
    }
    return typeof Reflect.get(value, Symbol.asyncIterator) === "function";
}

//
// The real module's call `name` on `owner`, bound to `owner`, for a call made with no run in
// flight. Every name asked for is one Node has, so a missing one is a mistake in this module.
//
export function realCall(owner: object, name: string): ApiCall {
    assert(name.length > 0);
    const found: unknown = Reflect.get(owner, name);
    assert(isApiCall(found), `The real node:fs has no call ${name}.`);
    const bound = found.bind(owner);
    assert(isApiCall(bound));
    return bound;
}

//
// The tree of the run in flight, or undefined when no run is in flight.
//
export function tree(): RunFiles | undefined {
    const files = nowRunning()?.files;
    if (files !== undefined) assert(files instanceof RunFiles);
    return files;
}

//
// The tree a synchronous call answers from. Only a run's own tree can answer a synchronous call
// without blocking the process on the disk. The code under test runs only with a run in flight, so
// a call made with none is a mistake in the tool.
//
export function treeFor(call: string): RunFiles {
    assert(call.length > 0);
    const files = tree();
    assert(files !== undefined, `The code under test called fs.${call} with no run in flight, and only a run's own tree answers a synchronous call.`);
    return files;
}

//
// `error` with the `code` Node gives the same failure, so the code under test tells it apart the
// way it tells Node's own apart. The code is enumerable, as it is on Node's own errors.
//
export function withCode(error: Error, code: string): Error {
    assert(error instanceof Error);
    assert(code.length > 0);
    Object.defineProperty(error, "code", {
        value: code,
        enumerable: true,
    });
    assert.equal(Reflect.get(error, "code"), code);
    return error;
}

//
// The error Node throws for an argument of the wrong type. `expected` says what the argument has to
// be, in Node's words.
//
export function invalidArgument(name: string, expected: string, given: unknown): Error {
    assert(name.length > 0);
    assert(expected.length > 0);
    return withCode(new TypeError(`The "${name}" argument must be ${expected}. Received ${typeof given}.`), "ERR_INVALID_ARG_TYPE");
}

//
// The error Node throws for an encoding it does not know.
//
export function unknownEncoding(given: string): Error {
    assert(!isEncoding(given));
    const error = withCode(new TypeError(`The argument 'encoding' is invalid encoding. Received '${given}'.`), "ERR_INVALID_ARG_VALUE");
    assert(error instanceof TypeError);
    return error;
}

//
// The error Node throws for a directory used after it was closed.
//
export function directoryClosed(): Error {
    return withCode(new Error("Directory handle was closed."), "ERR_DIR_CLOSED");
}

//
// The error Node gives `lchmod`, which Linux does not have.
//
export function lchmodMissing(): Error {
    return withCode(new Error("The lchmod() method is not implemented."), "ERR_METHOD_NOT_IMPLEMENTED");
}

//
// What a call into the tree threw, as the error it is. The tree throws only errors, so anything
// else is a mistake in it.
//
export function thrownError(thrown: unknown): Error {
    assert(thrown instanceof Error, `The tree threw ${String(thrown)}, which is not an error.`);
    return thrown;
}

//
// Whether what a call into the tree threw says the path is not there.
//
export function isMissingEntry(thrown: unknown): boolean {
    if (!isCodedError(thrown)) {
        return false;
    }
    return thrown.code === "ENOENT";
}

//
// The path a call was given, as text. Node takes a string, a `Buffer` or a `file:` URL.
//
export function pathText(given: unknown): string {
    if (typeof given === "string") {
        return given;
    }
    if (Buffer.isBuffer(given)) {
        return given.toString("utf8");
    }
    if (given instanceof URL) {
        const file = fileURLToPath(given);
        assert(path.isAbsolute(file));
        return file;
    }
    throw invalidArgument("path", "of type string or an instance of Buffer or URL", given);
}

//
// The options object a call was given, one holding only the encoding when it was given an encoding
// alone, or an empty one when it was given none.
//
export function optionsOf(given: unknown): Record<string, unknown> {
    if (typeof given === "string") {
        return {
            encoding: given,
        };
    }
    if (!isRecord(given)) {
        return {};
    }
    return given;
}

//
// The encoding `given` names. A name Node does not know fails as Node fails it.
//
export function encodingNamed(given: string): BufferEncoding {
    if (!isEncoding(given)) {
        throw unknownEncoding(given);
    }
    return given;
}

//
// The encoding a call asked for, "buffer" for bytes asked for by name, or undefined when it asked
// for none.
//
export function encodingOf(options: unknown): BufferEncoding | "buffer" | undefined {
    const encoding = optionsOf(options).encoding;
    if (typeof encoding !== "string") {
        return undefined;
    }
    if (encoding === "buffer") {
        return "buffer";
    }
    return encodingNamed(encoding);
}

//
// The encoding text given to a write is turned into bytes with: the one asked for, or UTF-8 when
// bytes or no encoding were asked for, as Node writes text.
//
export function textEncodingOf(encoding: BufferEncoding | "buffer" | undefined): BufferEncoding {
    if (encoding === undefined) {
        return "utf8";
    }
    if (encoding === "buffer") {
        return "utf8";
    }
    return encoding;
}

//
// What a read hands back: text in the encoding asked for, or the bytes.
//
export function asAsked(bytes: Buffer, options: unknown): string | Buffer {
    const encoding = encodingOf(options);
    if (encoding === undefined) {
        return bytes;
    }
    if (encoding === "buffer") {
        return bytes;
    }
    return bytes.toString(encoding);
}

//
// What was given to a write, as bytes.
//
export function asBytes(data: unknown, encoding: BufferEncoding | "buffer" | undefined): Buffer {
    if (typeof data === "string") {
        return Buffer.from(data, textEncodingOf(encoding));
    }
    if (ArrayBuffer.isView(data)) {
        const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        assert.equal(bytes.length, data.byteLength);
        assert.equal(bytes.buffer, data.buffer);
        return bytes;
    }
    throw invalidArgument("data", "of type string or an instance of Buffer, TypedArray or DataView", data);
}

//
// The bytes of a buffer the code under test passed, as one view of the same memory, so a read into
// any kind of buffer Node takes lands in that buffer. Node counts offsets and lengths in bytes
// whatever the kind of buffer.
//
export function byteView(given: unknown, name: string): Uint8Array {
    if (!ArrayBuffer.isView(given)) {
        throw invalidArgument(name, "an instance of Buffer, TypedArray or DataView", given);
    }
    const view = new Uint8Array(given.buffer, given.byteOffset, given.byteLength);
    assert.equal(view.byteLength, given.byteLength);
    assert.equal(view.buffer, given.buffer);
    return view;
}

//
// The buffers of a gathered read or write, each as a view of its bytes.
//
export function byteViews(given: unknown): Uint8Array[] {
    if (!isList(given)) {
        throw invalidArgument("buffers", "an instance of ArrayBufferView[]", given);
    }
    const views = given.map((piece) => byteView(piece, "buffers"));
    assert.equal(views.length, given.length);
    assert(views.every((view) => view instanceof Uint8Array));
    return views;
}

//
// The flags a write was asked to open with, as letters, or `otherwise` when it was given none.
//
export function flagOf(options: unknown, otherwise: string): string {
    assert(otherwise.length > 0);
    const flag = optionsOf(options).flag;
    if (typeof flag === "string") {
        return flag;
    }
    return otherwise;
}

//
// The permission bits a call was given as a number or as octal text, or `otherwise` when it was
// given neither.
//
export function modeOf(given: unknown, otherwise: number): number {
    assert(Number.isInteger(otherwise));
    if (typeof given === "number") {
        return given;
    }
    if (typeof given === "string") {
        return Number.parseInt(given, 8);
    }
    return otherwise;
}

//
// A time a call was given as a date, or as seconds in a number or in text, in milliseconds.
//
export function timeOf(given: unknown): number {
    if (given instanceof Date) {
        return given.getTime();
    }
    return Number(given) * 1000;
}

//
// Where in a file a read starts, or undefined to start where the last read ended, which Node asks
// for with no position, with null or with a negative one.
//
export function positionOf(given: unknown): number | undefined {
    if (given === undefined) {
        return undefined;
    }
    if (given === null) {
        return undefined;
    }
    const at = Number(given);
    if (at < 0) {
        return undefined;
    }
    return at;
}

//
// An entry that answers the questions Node's `Stats` and `Dirent` both answer about what kind of
// entry it is. The tree holds files, directories and links and no device, pipe or socket, so those
// questions are always answered no.
//
export class EntryOfKind {
    //
    // What the entry is.
    //
    protected readonly kind: EntryKind;

    //
    // Holds what the entry is, for the questions below.
    //
    constructor(kind: EntryKind) {
        assert(kind in typeBits, `${kind} is not a kind of entry the tree holds.`);
        this.kind = kind;
    }

    //
    // Whether the entry is a file.
    //
    isFile(): boolean {
        return this.kind === "file";
    }

    //
    // Whether the entry is a directory.
    //
    isDirectory(): boolean {
        return this.kind === "directory";
    }

    //
    // Whether the entry is a link.
    //
    isSymbolicLink(): boolean {
        return this.kind === "symlink";
    }

    //
    // Whether the entry is a device read in blocks, which no entry of the tree is.
    //
    isBlockDevice(): boolean {
        return false;
    }

    //
    // Whether the entry is a device read a character at a time, which no entry of the tree is.
    //
    isCharacterDevice(): boolean {
        return false;
    }

    //
    // Whether the entry is a named pipe, which no entry of the tree is.
    //
    isFIFO(): boolean {
        return false;
    }

    //
    // Whether the entry is a socket, which no entry of the tree is.
    //
    isSocket(): boolean {
        return false;
    }
}

//
// What `stat` hands back, with the fields Node's own carries.
//
export class Stats extends EntryOfKind {
    //
    // The device the entry is on. The tree is one device.
    //
    dev = 1;

    //
    // The number the entry is known by, unique within the tree.
    //
    ino: number;

    //
    // The type bits above the permission bits, as Node packs them.
    //
    mode: number;

    //
    // How many paths hold the entry.
    //
    nlink: number;

    //
    // The owner.
    //
    uid: number;

    //
    // The owning group.
    //
    gid: number;

    //
    // The device a device entry stands for, which no entry of the tree is.
    //
    rdev = 0;

    //
    // How many bytes the file holds, or the length of where a link points.
    //
    size: number;

    //
    // The block size Linux reports for an ordinary filesystem.
    //
    blksize = 4096;

    //
    // How many blocks of 512 bytes the entry takes, as Linux counts them.
    //
    blocks: number;

    //
    // When the entry was last read, in milliseconds since the epoch.
    //
    atimeMs: number;

    //
    // When what the entry holds last changed, in milliseconds since the epoch.
    //
    mtimeMs: number;

    //
    // When the entry or what it holds last changed, in milliseconds since the epoch.
    //
    ctimeMs: number;

    //
    // When the entry was made, in milliseconds since the epoch.
    //
    birthtimeMs: number;

    //
    // When the entry was last read.
    //
    atime: Date;

    //
    // When what the entry holds last changed.
    //
    mtime: Date;

    //
    // When the entry or what it holds last changed.
    //
    ctime: Date;

    //
    // When the entry was made.
    //
    birthtime: Date;

    //
    // Reads the fields from `entry`, held by `links` paths.
    //
    constructor(entry: Entry, links: number) {
        super(entry.kind);
        assert(Number.isInteger(links));
        assert(links >= 0);
        this.ino = entry.inode;
        this.mode = typeBits[entry.kind] | entry.mode;
        this.nlink = links;
        this.uid = entry.userId;
        this.gid = entry.groupId;
        this.size = entry.kind === "symlink" ? Buffer.byteLength(entry.target) : entry.bytes.length;
        this.blocks = Math.ceil(this.size / 512);
        this.atimeMs = entry.accessedMs;
        this.mtimeMs = entry.modifiedMs;
        this.ctimeMs = entry.changedMs;
        this.birthtimeMs = entry.bornMs;
        this.atime = new Date(entry.accessedMs);
        this.mtime = new Date(entry.modifiedMs);
        this.ctime = new Date(entry.changedMs);
        this.birthtime = new Date(entry.bornMs);
        assert(Number.isInteger(this.ino));
        assert(this.size >= 0);
        assert(this.blocks * 512 >= this.size);
    }
}

//
// One entry of a directory, as a caller that asked for the entries rather than the names reads it.
//
export class Dirent extends EntryOfKind {
    //
    // What the entry is called.
    //
    readonly name: string;

    //
    // Which directory it is in.
    //
    readonly parentPath: string;

    //
    // The same, by the older name Node still gives it.
    //
    readonly path: string;

    //
    // Holds an entry called `name` in `parentPath`.
    //
    constructor(name: string, parentPath: string, kind: EntryKind) {
        super(kind);
        assert(name.length > 0);
        assert(!name.includes("/"), `${name} is a path, not the name of one entry.`);
        assert(parentPath.startsWith("/"), `${parentPath} is not an absolute path.`);
        this.name = name;
        this.parentPath = parentPath;
        this.path = parentPath;
    }
}

//
// The stats of what `found` names.
//
export function statsOf(files: RunFiles, found: FoundEntry): Stats {
    const entry = found.entry;
    assert(entry !== undefined, `Stats were asked for of ${found.path}, which holds no entry.`);
    return new Stats(entry, files.linkCount(entry));
}

//
// The entry of a listing at the absolute path `held`, named by its last part and placed in the
// directory above it.
//
export function direntAt(files: RunFiles, held: string): Dirent {
    const slash = held.lastIndexOf("/");
    assert(slash >= 0, `${held} is not an absolute path.`);
    const kind = files.kindAt(held);
    assert(kind !== undefined, `The listing named ${held}, which the tree does not hold.`);
    return new Dirent(held.slice(slash + 1), slash === 0 ? "/" : held.slice(0, slash), kind);
}

//
// The path of `held` from `directory`, which holds it, as a recursive listing and `glob` name each
// entry.
//
export function relativeName(directory: string, held: string): string {
    assert(held.startsWith(directory), `${held} is not inside ${directory}.`);
    if (directory === "/") {
        return held.slice(1);
    }
    assert.equal(held[directory.length], "/");
    return held.slice(directory.length + 1);
}

//
// The names a listing gives its entries: each entry's path from the directory listed. The tree
// lists the entries under the directory a link in the path led to, which the path asked about does
// not say, so the directory is read off the first entry: a listing names the directory's own
// entries before those of the directories inside it.
//
export function listedNames(paths: readonly string[]): string[] {
    const first = paths[0];
    if (first === undefined) {
        return [];
    }
    const directory = path.posix.dirname(first);
    const names = paths.map((held) => relativeName(directory, held));
    assert.equal(names.length, paths.length);
    assert(names.every((name) => !name.startsWith("/")));
    return names;
}

//
// Reads the rest of an open file from where its last read ended. Each read takes at least one byte
// until the file ends and no file holds more bytes than Node's largest buffer, which bounds the
// reads.
//
export function readRest(files: RunFiles, number: number): Buffer {
    const pieces: Buffer[] = [];
    //
    // Pieces of 64 KiB, the size Node's own `readFileSync` reads a file of unknown length in.
    //
    const piece = Buffer.alloc(65536);
    let total = 0;
    let read = files.readOpen(number, piece, 0, piece.length, undefined);
    for (let reads = 0; read > 0; reads += 1) {
        assert(reads <= bufferConstants.MAX_LENGTH, `Reading open file ${number} did not end within the longest buffer Node holds.`);
        assert(read <= piece.length);
        pieces.push(Buffer.from(piece.subarray(0, read)));
        total += read;
        read = files.readOpen(number, piece, 0, piece.length, undefined);
    }
    const rest = Buffer.concat(pieces, total);
    assert.equal(rest.length, total);
    return rest;
}

//
// Writes every byte to an open file, writing again after a write that took only part. A write
// takes at least one byte, so there are at most as many writes as bytes.
//
export function writeAll(files: RunFiles, number: number, bytes: Buffer): void {
    let written = 0;
    for (let writes = 0; written < bytes.length; writes += 1) {
        assert(writes < bytes.length, `Writing to open file ${number} took more writes than it has bytes.`);
        const taken = files.writeOpen(number, bytes.subarray(written), undefined);
        assert(taken > 0, `A write to open file ${number} took no byte.`);
        written += taken;
    }
    assert.equal(written, bytes.length);
}

//
// Reads a whole file, by its path or by the number of an open file, as bytes or as text in the
// encoding asked for.
//
export function readFileSync(file: unknown, options: unknown): string | Buffer {
    const files = treeFor("readFileSync");
    if (typeof file === "number") {
        return asAsked(readRest(files, file), options);
    }
    const bytes = files.readFile(pathText(file));
    assert(Buffer.isBuffer(bytes));
    const read = asAsked(bytes, options);
    if (encodingOf(options) === undefined) assert(read === bytes);
    return read;
}

//
// Writes a whole file, by its path or by the number of an open file, replacing what it held unless
// the flags ask to append.
//
export function writeFileSync(file: unknown, data: unknown, options: unknown): void {
    const files = treeFor("writeFileSync");
    const bytes = asBytes(data, encodingOf(options));
    if (typeof file === "number") {
        writeAll(files, file, bytes);
        return;
    }
    const flag = flagOf(options, "w");
    files.writeFile(pathText(file), bytes, flag.startsWith("a"), flag.includes("x"));
}

//
// Adds to the end of a file, by its path or by the number of an open file.
//
export function appendFileSync(file: unknown, data: unknown, options: unknown): void {
    const files = treeFor("appendFileSync");
    const bytes = asBytes(data, encodingOf(options));
    if (typeof file === "number") {
        writeAll(files, file, bytes);
        return;
    }
    const flag = flagOf(options, "a");
    files.writeFile(pathText(file), bytes, true, flag.includes("x"));
}

//
// Whether a path is there. Any failure answers no, as Node answers it.
//
export function existsSync(file: unknown): boolean {
    const files = treeFor("existsSync");
    let at: string;
    try {
        at = pathText(file);
    }
    catch {
        //
        // A path Node cannot read as a path is not there, as Node answers it, whatever the reason
        // it cannot be read.
        //
        return false;
    }
    return files.exists(at);
}

//
// Reads what a path is, following a link at its end when `followLast` is set. A call asked not to
// throw for a missing path answers with undefined, as `statSync(path, { throwIfNoEntry: false })`
// does.
//
export function statWith(files: RunFiles, file: unknown, followLast: boolean, options: unknown): Stats | undefined {
    try {
        const stats = statsOf(files, files.stat(pathText(file), followLast));
        if (followLast) assert(!stats.isSymbolicLink(), "A stat that follows links found a link.");
        return stats;
    }
    catch (thrown) {
        if (optionsOf(options).throwIfNoEntry === false) {
            if (isMissingEntry(thrown)) {
                return undefined;
            }
        }
        throw thrown;
    }
}

//
// Reads what a path is, following a link at its end.
//
export function statSync(file: unknown, options: unknown): Stats | undefined {
    const files = treeFor("statSync");
    return statWith(files, file, true, options);
}

//
// Reads what a path is, the link itself when the path ends in one.
//
export function lstatSync(file: unknown, options: unknown): Stats | undefined {
    const files = treeFor("lstatSync");
    return statWith(files, file, false, options);
}

//
// Fails as Node fails when a path is not there. The run checks no permission the code under test
// could lack, so the access asked for in `mode` is always granted.
//
export function accessSync(file: unknown, mode: unknown): void {
    const files = treeFor("accessSync");
    const found = files.stat(pathText(file), true);
    assert(found.entry !== undefined);
}

//
// Lists a directory as names, as names in bytes or as entries. It lists everything below it too
// when asked to go into every directory inside.
//
export function readdirSync(file: unknown, options: unknown): string[] | Buffer[] | Dirent[] {
    const files = treeFor("readdirSync");
    const given = optionsOf(options);
    const paths = files.listDirectory(pathText(file), given.recursive === true);
    if (given.withFileTypes === true) {
        return paths.map((held) => direntAt(files, held));
    }
    const names = listedNames(paths);
    if (given.encoding === "buffer") {
        return names.map((name) => Buffer.from(name));
    }
    return names;
}

//
// Makes a directory, with every directory above it that is missing when asked to. Node takes the
// permission bits alone or in an options object.
//
export function mkdirSync(file: unknown, options: unknown): string | undefined {
    const files = treeFor("mkdirSync");
    const recursive = optionsOf(options).recursive === true;
    const mode = isRecord(options) ? modeOf(options.mode, directoryModeDefault) : modeOf(options, directoryModeDefault);
    const made = files.makeDirectory(pathText(file), recursive, mode);
    if (made !== undefined) assert.equal(files.kindAt(made), "directory");
    if (!recursive) {
        return undefined;
    }
    return made;
}

//
// Makes a directory named by `prefix` and characters drawn from the run's generator. The encoding
// asked for in `options` changes nothing, because the name made is text either way.
//
export function mkdtempSync(prefix: unknown, options: unknown): string {
    const files = treeFor("mkdtempSync");
    const made = files.makeTemporaryDirectory(pathText(prefix));
    assert(path.posix.isAbsolute(made));
    assert.equal(files.kindAt(made), "directory");
    return made;
}

//
// A temporary directory that removes itself, as `mkdtempDisposableSync` hands it back.
//
export interface IDisposableDirectory {
    //
    // Where the directory is.
    //
    path: string;

    //
    // Removes it and everything in it.
    //
    remove(): void;

    //
    // The same, for `using`.
    //
    [Symbol.dispose](): void;
}

//
// Makes a temporary directory that removes itself and everything in it when it is disposed of.
//
export function mkdtempDisposableSync(prefix: unknown, options: unknown): IDisposableDirectory {
    const files = treeFor("mkdtempDisposableSync");
    const made = files.makeTemporaryDirectory(pathText(prefix));
    assert(path.posix.isAbsolute(made));
    return {
        path: made,
        remove: () => files.remove(made, true, true),
        [Symbol.dispose]: () => files.remove(made, true, true),
    };
}

//
// Removes an empty directory, or a directory and everything in it when asked to.
//
export function rmdirSync(file: unknown, options: unknown): void {
    const files = treeFor("rmdirSync");
    const at = pathText(file);
    if (optionsOf(options).recursive === true) {
        files.remove(at, true, false);
    }
    else {
        files.removeDirectory(at);
    }
    assert.equal(files.kindAt(files.absolute(at)), undefined, `${at} is still there after it was removed.`);
}

//
// Removes a file, or a directory and everything in it when asked to, saying nothing about a path
// that is not there when asked to force it.
//
export function rmSync(file: unknown, options: unknown): void {
    const files = treeFor("rmSync");
    const given = optionsOf(options);
    const at = pathText(file);
    files.remove(at, given.recursive === true, given.force === true);
    assert.equal(files.kindAt(files.absolute(at)), undefined, `${at} is still there after it was removed.`);
}

//
// Removes one path to a file.
//
export function unlinkSync(file: unknown): void {
    const files = treeFor("unlinkSync");
    const at = pathText(file);
    files.unlink(at);
    assert.equal(files.kindAt(files.absolute(at)), undefined, `${at} is still there after it was removed.`);
}

//
// Moves an entry to another path.
//
export function renameSync(from: unknown, to: unknown): void {
    const files = treeFor("renameSync");
    files.rename(pathText(from), pathText(to));
}

//
// Copies a file, failing when the copy is there already and `mode` asks for that.
//
export function copyFileSync(from: unknown, to: unknown, mode: unknown): void {
    const files = treeFor("copyFileSync");
    files.copyFile(pathText(from), pathText(to), (Number(mode ?? 0) & real.constants.COPYFILE_EXCL) !== 0);
}

//
// Copies a file, or a directory and everything in it when asked to.
//
export function cpSync(from: unknown, to: unknown, options: unknown): void {
    const files = treeFor("cpSync");
    files.copyTree(pathText(from), pathText(to), optionsOf(options).recursive === true);
}

//
// Makes a link pointing at `target`. The kind of link Windows asks for in `type` means nothing on
// Linux.
//
export function symlinkSync(target: unknown, file: unknown, type: unknown): void {
    const files = treeFor("symlinkSync");
    files.symlink(pathText(target), pathText(file));
}

//
// Makes another path to an existing file.
//
export function linkSync(existing: unknown, file: unknown): void {
    const files = treeFor("linkSync");
    files.link(pathText(existing), pathText(file));
}

//
// Where a link points, as text or as bytes.
//
export function readlinkSync(file: unknown, options: unknown): string | Buffer {
    const files = treeFor("readlinkSync");
    const target = files.readLink(pathText(file));
    assert(typeof target === "string");
    if (encodingOf(options) === "buffer") {
        return Buffer.from(target);
    }
    return target;
}

//
// Where a path leads once every link in it is followed, as text or as bytes.
//
export function realpathSync(file: unknown, options: unknown): string | Buffer {
    const files = treeFor("realpathSync");
    const found = files.realPath(pathText(file));
    assert(path.posix.isAbsolute(found));
    if (encodingOf(options) === "buffer") {
        return Buffer.from(found);
    }
    return found;
}

//
// The native form, which Node gives as a property of `realpathSync` and which answers the same.
//
realpathSync.native = realpathSync;

//
// Sets the permission bits of what a path leads to.
//
export function chmodSync(file: unknown, mode: unknown): void {
    const files = treeFor("chmodSync");
    files.changeAttributes(pathText(file), true, "chmod", (entry) => {
        entry.mode = modeOf(mode, entry.mode) & changeableModeBits;
    });
}

//
// Sets the owner and group of what a path leads to.
//
export function chownSync(file: unknown, userId: unknown, groupId: unknown): void {
    const files = treeFor("chownSync");
    files.changeAttributes(pathText(file), true, "chown", (entry) => {
        entry.userId = Number(userId);
        entry.groupId = Number(groupId);
    });
}

//
// Sets the owner and group of a path, of the link itself when the path ends in one.
//
export function lchownSync(file: unknown, userId: unknown, groupId: unknown): void {
    const files = treeFor("lchownSync");
    files.changeAttributes(pathText(file), false, "lchown", (entry) => {
        entry.userId = Number(userId);
        entry.groupId = Number(groupId);
    });
}

//
// Sets when what a path leads to was last read and last changed.
//
export function utimesSync(file: unknown, accessed: unknown, modified: unknown): void {
    const files = treeFor("utimesSync");
    files.changeAttributes(pathText(file), true, "utime", (entry) => {
        entry.accessedMs = timeOf(accessed);
        entry.modifiedMs = timeOf(modified);
    });
}

//
// Sets when a path was last read and last changed, of the link itself when the path ends in one.
//
export function lutimesSync(file: unknown, accessed: unknown, modified: unknown): void {
    const files = treeFor("lutimesSync");
    files.changeAttributes(pathText(file), false, "lutime", (entry) => {
        entry.accessedMs = timeOf(accessed);
        entry.modifiedMs = timeOf(modified);
    });
}

//
// Cuts a file to a length, or to nothing when given none.
//
export function truncateSync(file: unknown, length: unknown): void {
    const files = treeFor("truncateSync");
    files.truncate(pathText(file), Number(length ?? 0));
}

//
// The flags `open` was given, as letters. Node takes the letters or the numbers of its constants,
// and reads a file when given neither.
//
export function flagLetters(given: unknown): string {
    if (typeof given === "string") {
        return given;
    }
    if (typeof given !== "number") {
        return "r";
    }
    const { O_WRONLY, O_RDWR, O_APPEND, O_EXCL, O_CREAT } = real.constants;
    const plus = (given & O_RDWR) !== 0 ? "+" : "";
    const exclusive = (given & O_EXCL) !== 0 ? "x" : "";
    if ((given & O_APPEND) !== 0) {
        return `a${exclusive}${plus}`;
    }
    if ((given & (O_WRONLY | O_CREAT)) !== 0) {
        return `w${exclusive}${plus}`;
    }
    return `r${plus}`;
}

//
// Opens a file and hands back the number it is held by.
//
export function openSync(file: unknown, flags: unknown, mode: unknown): number {
    const files = treeFor("openSync");
    const number = files.openFile(pathText(file), flagLetters(flags), modeOf(mode, fileModeDefault));
    assert(Number.isInteger(number));
    assert(number >= 0);
    return number;
}

//
// Closes an open file.
//
export function closeSync(number: unknown): void {
    const files = treeFor("closeSync");
    files.closeOpen(Number(number));
}

//
// Where a read goes and where it starts, from either way `read` is called: with the offset, length
// and position written out, or with them in an options object.
//
export interface IReadRequest {
    //
    // The bytes of the buffer read into.
    //
    into: Uint8Array;

    //
    // Where in it the bytes start.
    //
    offset: number;

    //
    // How many are asked for.
    //
    length: number;

    //
    // Where in the file the read starts, or undefined to start where the last read ended.
    //
    position: number | undefined;
}

//
// What `read` was asked for.
//
export function readRequest(buffer: unknown, offsetOrOptions: unknown, length: unknown, position: unknown): IReadRequest {
    const into = byteView(buffer, "buffer");
    if (isRecord(offsetOrOptions)) {
        const offset = Number(offsetOrOptions.offset ?? 0);
        return {
            into,
            offset,
            length: Number(offsetOrOptions.length ?? into.byteLength - offset),
            position: positionOf(offsetOrOptions.position),
        };
    }
    const offset = Number(offsetOrOptions ?? 0);
    return {
        into,
        offset,
        length: Number(length ?? into.byteLength - offset),
        position: positionOf(position),
    };
}

//
// Reads from an open file into a buffer and hands back how many bytes it read.
//
export function readSync(number: unknown, buffer: unknown, offsetOrOptions: unknown, length: unknown, position: unknown): number {
    const files = treeFor("readSync");
    const asked = readRequest(buffer, offsetOrOptions, length, position);
    const read = files.readOpen(Number(number), asked.into, asked.offset, asked.length, asked.position);
    assert(read >= 0);
    assert(read <= asked.length);
    return read;
}

//
// The bytes a `write` was given and where they go, from either way it is called: with a buffer, an
// offset, a length and a position, or with text, a position and an encoding.
//
export interface IWriteRequest {
    //
    // What is written.
    //
    bytes: Uint8Array;

    //
    // Where in the file it goes, or undefined for where the last write ended.
    //
    position: number | undefined;
}

//
// What `write` was asked to write.
//
export function writeRequest(data: unknown, second: unknown, third: unknown, fourth: unknown): IWriteRequest {
    if (typeof data === "string") {
        return {
            bytes: Buffer.from(data, typeof third === "string" ? encodingNamed(third) : "utf8"),
            position: typeof second === "number" ? second : undefined,
        };
    }
    const view = byteView(data, "buffer");
    if (isRecord(second)) {
        const offset = Number(second.offset ?? 0);
        const length = Number(second.length ?? view.byteLength - offset);
        return {
            bytes: view.subarray(offset, offset + length),
            position: typeof second.position === "number" ? second.position : undefined,
        };
    }
    const offset = Number(second ?? 0);
    const length = Number(third ?? view.byteLength - offset);
    return {
        bytes: view.subarray(offset, offset + length),
        position: typeof fourth === "number" ? fourth : undefined,
    };
}

//
// Writes to an open file and hands back how many bytes it took.
//
export function writeSync(number: unknown, data: unknown, second: unknown, third: unknown, fourth: unknown): number {
    const files = treeFor("writeSync");
    const asked = writeRequest(data, second, third, fourth);
    const written = files.writeOpen(Number(number), asked.bytes, asked.position);
    assert(written >= 0);
    assert(written <= asked.bytes.length);
    return written;
}

//
// Reads from an open file into each buffer in turn and hands back how many bytes it read. It stops
// at the first buffer that is not filled.
//
export function readvSync(number: unknown, buffers: unknown, position: unknown): number {
    const files = treeFor("readvSync");
    const views = byteViews(buffers);
    let total = 0;
    let at = typeof position === "number" ? position : undefined;
    for (const view of views) {
        const read = files.readOpen(Number(number), view, 0, view.byteLength, at);
        assert(read <= view.byteLength);
        total += read;
        if (at !== undefined) {
            at += read;
        }
        if (read < view.byteLength) {
            break;
        }
    }
    assert(total >= 0);
    return total;
}

//
// Writes each buffer to an open file in turn and hands back how many bytes it took. It stops at the
// first buffer written short.
//
export function writevSync(number: unknown, buffers: unknown, position: unknown): number {
    const files = treeFor("writevSync");
    const views = byteViews(buffers);
    let total = 0;
    let at = typeof position === "number" ? position : undefined;
    for (const view of views) {
        const written = files.writeOpen(Number(number), view, at);
        assert(written <= view.byteLength);
        total += written;
        if (at !== undefined) {
            at += written;
        }
        if (written < view.byteLength) {
            break;
        }
    }
    assert(total >= 0);
    return total;
}

//
// Reads what an open file is. The stats are given in numbers whether or not `options` asks for
// bigints, because no value in the tree is too large for a number.
//
export function fstatSync(number: unknown, options: unknown): Stats {
    const files = treeFor("fstatSync");
    return statsOf(files, files.statOpen(Number(number)));
}

//
// Cuts an open file to a length, or to nothing when given none.
//
export function ftruncateSync(number: unknown, length: unknown): void {
    const files = treeFor("ftruncateSync");
    files.truncateOpen(Number(number), Number(length ?? 0));
}

//
// Writes an open file through to the disk, which in memory moves no byte but can still fail.
//
export function fsyncSync(number: unknown): void {
    const files = treeFor("fsyncSync");
    files.syncOpen(Number(number), "fsync");
}

//
// Writes an open file's contents through to the disk, which in memory moves no byte but can still
// fail.
//
export function fdatasyncSync(number: unknown): void {
    const files = treeFor("fdatasyncSync");
    files.syncOpen(Number(number), "fdatasync");
}

//
// Sets the permission bits of an open file.
//
export function fchmodSync(number: unknown, mode: unknown): void {
    const files = treeFor("fchmodSync");
    files.changeOpenAttributes(Number(number), "fchmod", (entry) => {
        entry.mode = modeOf(mode, entry.mode) & changeableModeBits;
    });
}

//
// Sets the owner and group of an open file.
//
export function fchownSync(number: unknown, userId: unknown, groupId: unknown): void {
    const files = treeFor("fchownSync");
    files.changeOpenAttributes(Number(number), "fchown", (entry) => {
        entry.userId = Number(userId);
        entry.groupId = Number(groupId);
    });
}

//
// Sets when an open file was last read and last changed.
//
export function futimesSync(number: unknown, accessed: unknown, modified: unknown): void {
    const files = treeFor("futimesSync");
    files.changeOpenAttributes(Number(number), "futime", (entry) => {
        entry.accessedMs = timeOf(accessed);
        entry.modifiedMs = timeOf(modified);
    });
}

//
// What `statfs` hands back. The tree is in memory and has no size, so this is a filesystem with
// room to spare, which is what code that checks for room expects to find.
//
export interface IStatFs {
    //
    // The kind of filesystem, as the number Linux gives it.
    //
    type: number;

    //
    // The size of a block, in bytes.
    //
    bsize: number;

    //
    // How many blocks the filesystem holds.
    //
    blocks: number;

    //
    // How many blocks are free.
    //
    bfree: number;

    //
    // How many blocks are free to a user who is not the superuser.
    //
    bavail: number;

    //
    // How many entries the filesystem holds room for.
    //
    files: number;

    //
    // How many more entries it has room for.
    //
    ffree: number;
}

//
// What the filesystem a path is on holds room for. The type is the number Linux gives `tmpfs`, the
// filesystem that keeps its files in memory as the tree does. The counts are those of a filesystem
// of 4 GiB in blocks of 4 KiB with half of it free.
//
export function statfsSync(file: unknown, options: unknown): IStatFs {
    const files = treeFor("statfsSync");
    const found = files.stat(pathText(file), true);
    assert(found.entry !== undefined);
    return {
        type: 0x01021994,
        bsize: 4096,
        blocks: 1048576,
        bfree: 524288,
        bavail: 524288,
        files: 1048576,
        ffree: 524288,
    };
}

//
// Every path in the tree that matches a pattern, as `globSync` finds them, in sorted order and
// relative to the directory the search starts in.
//
export function globSync(pattern: unknown, options: unknown): string[] {
    const files = treeFor("globSync");
    const given = optionsOf(options);
    const start = files.absolute(typeof given.cwd === "string" ? given.cwd : files.cwd());
    const patterns = isList(pattern) ? pattern.map((one) => String(one)) : [String(pattern)];
    let listed: string[];
    try {
        listed = files.listDirectory(start, true);
    }
    catch (thrown) {
        //
        // A search that starts in a directory that is not there finds no match, as Node's does.
        //
        if (isMissingEntry(thrown)) {
            return [];
        }
        throw thrown;
    }
    return listedNames(listed).filter((held) => patterns.some((one) => path.posix.matchesGlob(held, one))).sort();
}

//
// Fails a call given an `AbortSignal` that is aborted, as Node fails it.
//
export function refuseAborted(options: unknown): void {
    const running = nowRunning();
    if (running === undefined) {
        return;
    }
    const signal = optionsOf(options).signal;
    if (!(signal instanceof AbortSignal)) {
        return;
    }
    if (isAborted(running.injector, signal)) {
        throw abortError();
    }
}

//
// A synchronous call that first fails when the options it was given at `optionsAt` carry an aborted
// signal, for the calls Node lets a signal abort.
//
export function abortable(sync: ApiCall, optionsAt: number): ApiCall {
    assert(Number.isInteger(optionsAt));
    assert(optionsAt > 0);
    return (...args: unknown[]): unknown => {
        refuseAborted(args[optionsAt]);
        return sync(...args);
    };
}

//
// The callback form of a synchronous call: the callback is the last argument. It is called after
// the call with the error it threw or with what it handed back. The call itself is made at
// once, so its places come in the order the code under test made its calls.
//
export function callbackForm(name: string, sync: ApiCall, answers: CallbackAnswer): ApiCall {
    assert(name.length > 0);
    assert(!name.endsWith("Sync"), `${name} is a synchronous call, not a callback form.`);
    return (...args: unknown[]): void => {
        if (tree() === undefined) {
            realCall(real, name)(...args);
            return;
        }
        const done = args.pop();
        if (!isApiCall(done)) {
            throw invalidArgument("cb", "of type function", done);
        }
        let answer: unknown;
        try {
            answer = sync(...args);
        }
        catch (thrown) {
            queueMicrotask(() => done(thrown));
            return;
        }
        queueMicrotask(() => done(null, ...answers(answer, args)));
    };
}

//
// What a callback is handed for a call that answers with one value.
//
export function oneAnswer(answer: unknown): unknown[] {
    return [answer];
}

//
// What a callback is handed for a call that answers with no value.
//
export function noAnswer(): unknown[] {
    return [];
}

//
// What the callbacks of `read`, `write`, `readv` and `writev` are handed: how many bytes were moved
// and the buffer or buffers they were moved through.
//
export function byteCountAnswer(answer: unknown, args: unknown[]): unknown[] {
    assert.equal(typeof answer, "number");
    return [answer, args[1]];
}

//
// The promise form of a synchronous call. Its synchronous part runs at once, so its places come in
// the order the code under test made its calls. The promise settles with what it handed back.
// A call given a file handle in place of a path is made on the number the handle holds.
//
export function promiseForm(name: string, sync: ApiCall): PromiseCall {
    assert(name.length > 0);
    assert(!name.endsWith("Sync"), `${name} is a synchronous call, not a promise form.`);
    return async (...args: unknown[]): Promise<unknown> => {
        if (tree() === undefined) {
            return realCall(real.promises, name)(...args);
        }
        const [first, ...rest] = args;
        if (first instanceof FileHandle) {
            return sync(first.fd, ...rest);
        }
        return sync(...args);
    };
}

//
// Checks that a path is there, then calls back.
//
export const access = callbackForm("access", accessSync, noAnswer);

//
// Adds to the end of a file, then calls back. A signal in the options can abort it.
//
export const appendFile = callbackForm("appendFile", abortable(appendFileSync, 2), noAnswer);

//
// Sets the permission bits of what a path leads to, then calls back.
//
export const chmod = callbackForm("chmod", chmodSync, noAnswer);

//
// Sets the owner and group of what a path leads to, then calls back.
//
export const chown = callbackForm("chown", chownSync, noAnswer);

//
// Closes an open file, then calls back.
//
export const close = callbackForm("close", closeSync, noAnswer);

//
// Copies a file, then calls back.
//
export const copyFile = callbackForm("copyFile", copyFileSync, noAnswer);

//
// Copies a file, or a directory and everything in it, then calls back.
//
export const cp = callbackForm("cp", cpSync, noAnswer);

//
// Sets the permission bits of an open file, then calls back.
//
export const fchmod = callbackForm("fchmod", fchmodSync, noAnswer);

//
// Sets the owner and group of an open file, then calls back.
//
export const fchown = callbackForm("fchown", fchownSync, noAnswer);

//
// Writes an open file's contents through to the disk, then calls back.
//
export const fdatasync = callbackForm("fdatasync", fdatasyncSync, noAnswer);

//
// Calls back with what an open file is.
//
export const fstat = callbackForm("fstat", fstatSync, oneAnswer);

//
// Writes an open file through to the disk, then calls back.
//
export const fsync = callbackForm("fsync", fsyncSync, noAnswer);

//
// Cuts an open file to a length, then calls back.
//
export const ftruncate = callbackForm("ftruncate", ftruncateSync, noAnswer);

//
// Sets when an open file was last read and last changed, then calls back.
//
export const futimes = callbackForm("futimes", futimesSync, noAnswer);

//
// Calls back with every path that matches a pattern.
//
export const glob = callbackForm("glob", globSync, oneAnswer);

//
// Sets the owner and group of a path, of the link itself when the path ends in one, then calls
// back.
//
export const lchown = callbackForm("lchown", lchownSync, noAnswer);

//
// Makes another path to an existing file, then calls back.
//
export const link = callbackForm("link", linkSync, noAnswer);

//
// Calls back with what a path is, the link itself when the path ends in one.
//
export const lstat = callbackForm("lstat", lstatSync, oneAnswer);

//
// Sets when a path was last read and last changed, of the link itself when the path ends in one,
// then calls back.
//
export const lutimes = callbackForm("lutimes", lutimesSync, noAnswer);

//
// Makes a directory, then calls back with the first directory it made when asked to make the
// missing ones above it.
//
export const mkdir = callbackForm("mkdir", mkdirSync, oneAnswer);

//
// Makes a temporary directory, then calls back with where it is.
//
export const mkdtemp = callbackForm("mkdtemp", mkdtempSync, oneAnswer);

//
// Opens a file, then calls back with the number it is held by.
//
export const open = callbackForm("open", openSync, oneAnswer);

//
// Opens a directory to read entry by entry, then calls back with it.
//
export const opendir = callbackForm("opendir", opendirSync, oneAnswer);

//
// Reads from an open file into a buffer, then calls back with how many bytes it read and the
// buffer.
//
export const read = callbackForm("read", readSync, byteCountAnswer);

//
// Calls back with what a directory holds.
//
export const readdir = callbackForm("readdir", readdirSync, oneAnswer);

//
// Calls back with a whole file. A signal in the options can abort it.
//
export const readFile = callbackForm("readFile", abortable(readFileSync, 1), oneAnswer);

//
// Calls back with where a link points.
//
export const readlink = callbackForm("readlink", readlinkSync, oneAnswer);

//
// Reads from an open file into each buffer in turn, then calls back with how many bytes it read and
// the buffers.
//
export const readv = callbackForm("readv", readvSync, byteCountAnswer);

//
// Calls back with where a path leads once every link in it is followed. Its native form answers the
// same.
//
export const realpath = Object.assign(callbackForm("realpath", realpathSync, oneAnswer), {
    native: callbackForm("realpath", realpathSync, oneAnswer),
});

//
// Moves an entry to another path, then calls back.
//
export const rename = callbackForm("rename", renameSync, noAnswer);

//
// Removes a file, or a directory and everything in it, then calls back.
//
export const rm = callbackForm("rm", rmSync, noAnswer);

//
// Removes a directory, then calls back.
//
export const rmdir = callbackForm("rmdir", rmdirSync, noAnswer);

//
// Calls back with what a path is, following a link at its end.
//
export const stat = callbackForm("stat", statSync, oneAnswer);

//
// Calls back with what the filesystem a path is on holds room for.
//
export const statfs = callbackForm("statfs", statfsSync, oneAnswer);

//
// Makes a link, then calls back.
//
export const symlink = callbackForm("symlink", symlinkSync, noAnswer);

//
// Cuts a file to a length, then calls back.
//
export const truncate = callbackForm("truncate", truncateSync, noAnswer);

//
// Removes one path to a file, then calls back.
//
export const unlink = callbackForm("unlink", unlinkSync, noAnswer);

//
// Sets when what a path leads to was last read and last changed, then calls back.
//
export const utimes = callbackForm("utimes", utimesSync, noAnswer);

//
// Writes to an open file, then calls back with how many bytes it took and what was written.
//
export const write = callbackForm("write", writeSync, byteCountAnswer);

//
// Writes a whole file, then calls back. A signal in the options can abort it.
//
export const writeFile = callbackForm("writeFile", abortable(writeFileSync, 2), noAnswer);

//
// Writes each buffer to an open file in turn, then calls back with how many bytes it took and the
// buffers.
//
export const writev = callbackForm("writev", writevSync, byteCountAnswer);

//
// The older way of asking whether a path is there, which hands the answer to a callback and hands
// it no error.
//
export function exists(file: unknown, done: unknown): void {
    if (tree() === undefined) {
        realCall(real, "exists")(file, done);
        return;
    }
    if (!isApiCall(done)) {
        throw invalidArgument("cb", "of type function", done);
    }
    const answer = existsSync(file);
    queueMicrotask(() => done(answer));
}

//
// Whether a path is on the disk, asked of the real `exists`, which does not block, for a promise
// made with no run in flight.
//
export function realExists(file: unknown): Promise<boolean> {
    return new Promise((settle) => {
        realCall(real, "exists")(file, settle);
    });
}

//
// What `util.promisify` makes of `exists`: a promise of whether the path is there, which Node's own
// gives because the callback is handed no error to reject with.
//
export async function existsPromise(file: unknown): Promise<boolean> {
    if (tree() === undefined) {
        return realExists(file);
    }
    return existsSync(file);
}

Object.defineProperty(exists, promisify.custom, {
    value: existsPromise,
});

//
// What a read through a file handle hands back.
//
export interface IHandleRead {
    //
    // How many bytes were read.
    //
    bytesRead: number;

    //
    // The buffer they were read into, the one the caller passed or the one made for it.
    //
    buffer: unknown;
}

//
// What a write through a file handle hands back.
//
export interface IHandleWrite {
    //
    // How many bytes were written.
    //
    bytesWritten: number;

    //
    // What the caller passed to be written.
    //
    buffer: unknown;
}

//
// What a gathered read through a file handle hands back.
//
export interface IHandleReadv {
    //
    // How many bytes were read.
    //
    bytesRead: number;

    //
    // The buffers the caller passed.
    //
    buffers: unknown;
}

//
// What a gathered write through a file handle hands back.
//
export interface IHandleWritev {
    //
    // How many bytes were written.
    //
    bytesWritten: number;

    //
    // The buffers the caller passed.
    //
    buffers: unknown;
}

//
// A file opened with `fs.promises.open`, as Node hands it back. Each call is made on the number the
// file is held by, through the same calls the synchronous forms make.
//
export class FileHandle extends EventEmitter {
    //
    // The number the file is held by.
    //
    readonly fd: number;

    //
    // Holds the file opened as `fd`.
    //
    constructor(fd: number) {
        super();
        assert(Number.isInteger(fd));
        assert(fd >= 0);
        this.fd = fd;
    }

    //
    // Reads into a buffer. Node reads into a buffer of its own of 16 KiB when given none.
    //
    async read(buffer: unknown, offset: unknown, length: unknown, position: unknown): Promise<IHandleRead> {
        const into = buffer ?? Buffer.alloc(16384);
        return {
            bytesRead: readSync(this.fd, into, offset, length, position),
            buffer: into,
        };
    }

    //
    // Writes bytes or text.
    //
    async write(data: unknown, second: unknown, third: unknown, fourth: unknown): Promise<IHandleWrite> {
        return {
            bytesWritten: writeSync(this.fd, data, second, third, fourth),
            buffer: data,
        };
    }

    //
    // Reads into each buffer in turn.
    //
    async readv(buffers: unknown, position: unknown): Promise<IHandleReadv> {
        return {
            bytesRead: readvSync(this.fd, buffers, position),
            buffers,
        };
    }

    //
    // Writes each buffer in turn.
    //
    async writev(buffers: unknown, position: unknown): Promise<IHandleWritev> {
        return {
            bytesWritten: writevSync(this.fd, buffers, position),
            buffers,
        };
    }

    //
    // Reads the rest of the file.
    //
    async readFile(options: unknown): Promise<string | Buffer> {
        refuseAborted(options);
        return readFileSync(this.fd, options);
    }

    //
    // Writes where the last write ended.
    //
    async writeFile(data: unknown, options: unknown): Promise<void> {
        refuseAborted(options);
        writeFileSync(this.fd, data, options);
    }

    //
    // Writes where the last write ended, which is the end for a file opened to append.
    //
    async appendFile(data: unknown, options: unknown): Promise<void> {
        refuseAborted(options);
        appendFileSync(this.fd, data, options);
    }

    //
    // Reads what the file is.
    //
    async stat(): Promise<Stats> {
        return fstatSync(this.fd, undefined);
    }

    //
    // Cuts the file to a length.
    //
    async truncate(length: unknown): Promise<void> {
        ftruncateSync(this.fd, length);
    }

    //
    // Writes the file through to the disk.
    //
    async sync(): Promise<void> {
        fsyncSync(this.fd);
    }

    //
    // Writes the file's contents through to the disk.
    //
    async datasync(): Promise<void> {
        fdatasyncSync(this.fd);
    }

    //
    // Sets the file's permission bits.
    //
    async chmod(mode: unknown): Promise<void> {
        fchmodSync(this.fd, mode);
    }

    //
    // Sets the file's owner and group.
    //
    async chown(userId: unknown, groupId: unknown): Promise<void> {
        fchownSync(this.fd, userId, groupId);
    }

    //
    // Sets when the file was last read and last changed.
    //
    async utimes(accessed: unknown, modified: unknown): Promise<void> {
        futimesSync(this.fd, accessed, modified);
    }

    //
    // Closes the file and says so to whoever listens.
    //
    async close(): Promise<void> {
        closeSync(this.fd);
        this.emit("close");
    }

    //
    // Closes the file, for `await using`.
    //
    async [Symbol.asyncDispose](): Promise<void> {
        await this.close();
    }

    //
    // A stream reading the file.
    //
    createReadStream(options: unknown): ReadStream {
        return new ReadStream(undefined, {
            ...optionsOf(options),
            fd: this.fd,
        });
    }

    //
    // A stream writing the file.
    //
    createWriteStream(options: unknown): WriteStream {
        return new WriteStream(undefined, {
            ...optionsOf(options),
            fd: this.fd,
        });
    }
}

//
// Opens a file for `fs.promises.open`.
//
export function openHandle(file: unknown, flags: unknown, mode: unknown): FileHandle {
    return new FileHandle(openSync(file, flags, mode));
}

//
// A file read as a stream. It hands over what the run's tree holds in one piece and ends.
//
export class ReadStream extends Readable {
    //
    // The path the stream reads, or empty for a stream made on an open file's number.
    //
    readonly path: string;

    //
    // How many bytes it has handed over.
    //
    bytesRead = 0;

    //
    // Whether the file is still to be opened, which it never is: it is opened at once.
    //
    readonly pending = false;

    //
    // The number the file is held by, or undefined when opening it failed or it was closed.
    //
    fd: number | undefined;

    //
    // The tree the stream reads.
    //
    private readonly files: RunFiles;

    //
    // Where the stream starts reading.
    //
    private readonly start: number;

    //
    // Where it stops, inclusive, or undefined for the end of the file.
    //
    private readonly end: number | undefined;

    //
    // Whether the stream closes the file when it ends, which it does unless told otherwise.
    //
    private readonly autoClose: boolean;

    //
    // Opens `file` or takes the open file `options.fd`, then says so once whoever made it can
    // listen. A file that fails to open destroys the stream with the error.
    //
    constructor(file: unknown, options: unknown) {
        const given = optionsOf(options);
        super({
            encoding: isEncoding(given.encoding) ? given.encoding : undefined,
            highWaterMark: typeof given.highWaterMark === "number" ? given.highWaterMark : undefined,
        });
        this.files = treeFor("createReadStream");
        this.path = file === undefined ? "" : pathText(file);
        this.start = typeof given.start === "number" ? given.start : 0;
        this.end = typeof given.end === "number" ? given.end : undefined;
        this.autoClose = given.autoClose !== false;
        try {
            this.fd = typeof given.fd === "number" ? given.fd : this.files.openFile(this.path, typeof given.flags === "string" ? given.flags : "r", fileModeDefault);
        }
        catch (thrown) {
            this.destroy(thrownError(thrown));
            return;
        }
        queueMicrotask(() => {
            this.emit("open", this.fd);
            this.emit("ready");
        });
    }

    //
    // Hands over the whole of what is to be read in one piece and ends. The stream never reads
    // again after it has ended. One whose file did not open was destroyed before any read.
    //
    override _read(): void {
        const fd = this.fd;
        assert(fd !== undefined, "A read stream whose file is not open was read.");
        let bytes: Buffer;
        try {
            bytes = this.files.readForStream(fd, this.start, this.end);
        }
        catch (thrown) {
            this.destroy(thrownError(thrown));
            return;
        }
        this.bytesRead += bytes.length;
        if (bytes.length > 0) {
            this.push(bytes);
        }
        this.push(null);
    }

    //
    // Closes the file unless told to leave it open, then finishes destroying the stream.
    //
    override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
        if (this.autoClose) {
            if (this.fd !== undefined) {
                this.files.closeOpen(this.fd);
                this.fd = undefined;
            }
        }
        done(error);
    }

    //
    // Ends the stream, then calls `done` when given one.
    //
    close(done: ((error: Error | null) => void) | undefined): void {
        this.destroy();
        if (done !== undefined) {
            queueMicrotask(() => done(null));
        }
    }
}

//
// A file written as a stream. Every piece is written to the run's tree as it arrives.
//
export class WriteStream extends Writable {
    //
    // The path the stream writes, or empty for a stream made on an open file's number.
    //
    readonly path: string;

    //
    // How many bytes it has written.
    //
    bytesWritten = 0;

    //
    // Whether the file is still to be opened, which it never is: it is opened at once.
    //
    readonly pending = false;

    //
    // The number the file is held by, or undefined when opening it failed or it was closed.
    //
    fd: number | undefined;

    //
    // The tree the stream writes.
    //
    private readonly files: RunFiles;

    //
    // Whether the stream closes the file when it ends, which it does unless told otherwise.
    //
    private readonly autoClose: boolean;

    //
    // Opens `file` or takes the open file `options.fd`, then says so once whoever made it can
    // listen. A file that fails to open destroys the stream with the error.
    //
    constructor(file: unknown, options: unknown) {
        const given = optionsOf(options);
        super({
            decodeStrings: true,
            defaultEncoding: isEncoding(given.encoding) ? given.encoding : "utf8",
        });
        this.files = treeFor("createWriteStream");
        this.path = file === undefined ? "" : pathText(file);
        this.autoClose = given.autoClose !== false;
        try {
            this.fd = typeof given.fd === "number" ? given.fd : this.files.openFile(this.path, typeof given.flags === "string" ? given.flags : "w", modeOf(given.mode, fileModeDefault));
        }
        catch (thrown) {
            this.destroy(thrownError(thrown));
            return;
        }
        queueMicrotask(() => {
            this.emit("open", this.fd);
            this.emit("ready");
        });
    }

    //
    // Writes one piece to the tree. A stream whose file did not open was destroyed before any
    // write.
    //
    override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
        const fd = this.fd;
        assert(fd !== undefined, "A write stream whose file is not open was written to.");
        try {
            writeAll(this.files, fd, chunk);
        }
        catch (thrown) {
            done(thrownError(thrown));
            return;
        }
        this.bytesWritten += chunk.length;
        done(null);
    }

    //
    // Closes the file unless told to leave it open, then finishes destroying the stream.
    //
    override _destroy(error: Error | null, done: (error?: Error | null) => void): void {
        if (this.autoClose) {
            if (this.fd !== undefined) {
                this.files.closeOpen(this.fd);
                this.fd = undefined;
            }
        }
        done(error);
    }

    //
    // Ends the stream once what was written is in the tree, then calls `done` when given one.
    //
    close(done: ((error: Error | null) => void) | undefined): void {
        this.end(() => {
            this.destroy();
            if (done !== undefined) {
                done(null);
            }
        });
    }
}

//
// A stream reading a file, from the run's tree, or from the disk with no run in flight.
//
export function createReadStream(file: unknown, options: unknown): Readable {
    if (tree() === undefined) {
        const stream = realCall(real, "createReadStream")(file, options);
        assert(stream instanceof Readable);
        return stream;
    }
    return new ReadStream(file, options);
}

//
// A stream writing a file, to the run's tree, or to the disk with no run in flight.
//
export function createWriteStream(file: unknown, options: unknown): Writable {
    if (tree() === undefined) {
        const stream = realCall(real, "createWriteStream")(file, options);
        assert(stream instanceof Writable);
        return stream;
    }
    return new WriteStream(file, options);
}

//
// The stream Node writes text to a file through, made with a path or a number. It writes each piece
// to the run's tree at once, so it never holds a piece back.
//
export class Utf8Stream extends EventEmitter {
    //
    // The number the file is held by.
    //
    readonly fd: number;

    //
    // The tree the stream writes.
    //
    private readonly files: RunFiles;

    //
    // Takes the open file `options.fd`, or opens `options.dest` to append unless told to replace it.
    //
    constructor(options: unknown) {
        super();
        const given = optionsOf(options);
        this.files = treeFor("Utf8Stream");
        this.fd = typeof given.fd === "number" ? given.fd : this.files.openFile(pathText(given.dest), given.append === false ? "w" : "a", fileModeDefault);
        assert(Number.isInteger(this.fd));
    }

    //
    // Writes a piece of text to the file at once.
    //
    write(data: unknown): boolean {
        writeAll(this.files, this.fd, asBytes(data, "utf8"));
        return true;
    }

    //
    // Calls `done` when given one, since there is no piece waiting to be written.
    //
    flush(done: ((error: Error | null) => void) | undefined): void {
        if (done !== undefined) {
            queueMicrotask(() => done(null));
        }
    }

    //
    // Writes what is waiting, which is no piece, since every write went to the tree at once.
    //
    flushSync(): void {
        assert(Number.isInteger(this.fd));
    }

    //
    // Ends the stream.
    //
    end(): void {
        this.destroy();
    }

    //
    // Closes the file and says so to whoever listens.
    //
    destroy(): void {
        this.files.closeOpen(this.fd);
        queueMicrotask(() => this.emit("close"));
    }
}

//
// A directory opened to read entry by entry, as `opendir` hands it back.
//
export class Dir {
    //
    // The directory opened.
    //
    readonly path: string;

    //
    // Its entries, in sorted order.
    //
    private readonly entries: Dirent[];

    //
    // How many entries are read before the listing fails part way through, or undefined when it
    // does not fail.
    //
    private readonly failsAfter: number | undefined;

    //
    // How many entries have been read.
    //
    private index = 0;

    //
    // Whether the directory has been closed.
    //
    private closed = false;

    //
    // Lists the directory at `at` in the tree, which is the call that can fail.
    //
    constructor(files: RunFiles, at: string) {
        this.path = at;
        const opened = files.openDirectory(at);
        this.entries = opened.paths.map((held) => direntAt(files, held));
        this.failsAfter = opened.failsAfter;
        assert.equal(this.entries.length, opened.paths.length);
        if (this.failsAfter !== undefined) assert(this.failsAfter <= this.entries.length);
    }

    //
    // The next entry, or null once every entry is read, as Node's own answers.
    //
    readSync(): Dirent | null {
        assert(this.index <= this.entries.length);
        if (this.closed) {
            throw directoryClosed();
        }
        if (this.failsAfter !== undefined) {
            if (this.index >= this.failsAfter) {
                throw fileError("EIO", "scandir", this.path);
            }
        }
        const entry = this.entries[this.index];
        if (entry === undefined) {
            return null;
        }
        this.index += 1;
        assert(this.index <= this.entries.length);
        return entry;
    }

    //
    // The next entry, handed to `done` when given one and as a promise otherwise.
    //
    read(done: ((error: Error | null, entry: Dirent | null | undefined) => void) | undefined): Promise<Dirent | null> | undefined {
        if (done === undefined) {
            return Promise.resolve().then(() => this.readSync());
        }
        let entry: Dirent | null;
        try {
            entry = this.readSync();
        }
        catch (thrown) {
            queueMicrotask(() => done(thrownError(thrown), undefined));
            return undefined;
        }
        queueMicrotask(() => done(null, entry));
        return undefined;
    }

    //
    // Closes the directory. A directory closed twice fails as Node's does.
    //
    closeSync(): void {
        if (this.closed) {
            throw directoryClosed();
        }
        this.closed = true;
    }

    //
    // Closes the directory, telling `done` when given one and settling a promise otherwise.
    //
    close(done: ((error: Error | null) => void) | undefined): Promise<void> | undefined {
        if (done === undefined) {
            return Promise.resolve().then(() => this.closeSync());
        }
        try {
            this.closeSync();
        }
        catch (thrown) {
            queueMicrotask(() => done(thrownError(thrown)));
            return undefined;
        }
        queueMicrotask(() => done(null));
        return undefined;
    }

    //
    // Hands over every entry left, for `for await`, then closes the directory. There is one
    // read per entry and one more that finds the end.
    //
    async *[Symbol.asyncIterator](): AsyncGenerator<Dirent> {
        try {
            let entry = this.readSync();
            for (let reads = 0; entry !== null; reads += 1) {
                assert(reads < this.entries.length, `The directory ${this.path} handed over more entries than it holds.`);
                yield entry;
                entry = this.readSync();
            }
        }
        finally {
            if (!this.closed) {
                this.closeSync();
            }
        }
    }

    //
    // Closes the directory, for `using`, unless it is closed already.
    //
    [Symbol.dispose](): void {
        if (!this.closed) {
            this.closeSync();
        }
    }

    //
    // The same, for `await using`.
    //
    async [Symbol.asyncDispose](): Promise<void> {
        this[Symbol.dispose]();
    }
}

//
// Opens a directory to read entry by entry. The size of Node's own reads asked for in `options`
// changes nothing, because the whole listing is in memory.
//
export function opendirSync(file: unknown, options: unknown): Dir {
    const files = treeFor("opendirSync");
    return new Dir(files, pathText(file));
}

//
// A watcher on a path. The tree changes only when the code under test changes it. A change made
// while a run is in flight is not reported, so a watcher hears no change.
//
export class FSWatcher extends EventEmitter {
    //
    // Stops watching and says so to whoever listens.
    //
    close(): void {
        queueMicrotask(() => this.emit("close"));
    }

    //
    // Keeps the process alive while watching, which a watcher that hears no change has no need to.
    //
    ref(): this {
        return this;
    }

    //
    // Lets the process end while watching.
    //
    unref(): this {
        return this;
    }
}

//
// Watches a path, on the disk with no run in flight. With a run in flight the watcher hears no
// change. The listener, given in `options` or after it, is kept for a change that never comes.
//
export function watch(file: unknown, options: unknown, listener: unknown): EventEmitter {
    if (tree() === undefined) {
        const watcher = realCall(real, "watch")(file, options, listener);
        assert(watcher instanceof EventEmitter);
        return watcher;
    }
    const watcher = new FSWatcher();
    const heard = isApiCall(options) ? options : listener;
    if (isApiCall(heard)) {
        watcher.on("change", heard);
    }
    return watcher;
}

//
// Polls a path for changes, on the disk with no run in flight. With a run in flight the watcher
// hears no change.
//
export function watchFile(file: unknown, options: unknown, listener: unknown): EventEmitter {
    if (tree() === undefined) {
        const watcher = realCall(real, "watchFile")(file, options, listener);
        assert(watcher instanceof EventEmitter);
        return watcher;
    }
    return new FSWatcher();
}

//
// Stops polling a path, on the disk with no run in flight. With a run in flight no poll was
// started, so there is none to stop.
//
export function unwatchFile(file: unknown, listener: unknown): void {
    if (tree() === undefined) {
        realCall(real, "unwatchFile")(file, listener);
    }
}

//
// A file's bytes as a blob of the type asked for, from the run's tree, or from the disk with no run
// in flight.
//
export async function openAsBlob(file: unknown, options: unknown): Promise<Blob> {
    if (tree() === undefined) {
        const blob = await realCall(real, "openAsBlob")(file, options);
        assert(blob instanceof Blob);
        return blob;
    }
    const type = optionsOf(options).type;
    const bytes = readFileSync(file, undefined);
    assert(Buffer.isBuffer(bytes));
    return new Blob([new Uint8Array(bytes)], {
        type: typeof type === "string" ? type : "",
    });
}

//
// The next change a promise watch hands over, which never comes: the promise rejects when `signal`
// aborts and otherwise never settles.
//
export function nextChange(signal: AbortSignal | undefined): Promise<IteratorResult<never>> {
    return new Promise<IteratorResult<never>>((_settle, refuse) => {
        if (signal === undefined) {
            return;
        }
        if (signal.aborted) {
            refuse(abortError());
            return;
        }
        signal.addEventListener("abort", () => refuse(abortError()), {
            once: true,
        });
    });
}

//
// Watches for `fs.promises.watch`. The tree reports no change, so the watch hands over no event and
// ends only when the signal in `options` is aborted.
//
export function watchForChanges(options: unknown): AsyncIterable<never> {
    const given = optionsOf(options).signal;
    const signal = given instanceof AbortSignal ? given : undefined;
    return {
        [Symbol.asyncIterator]: () => ({
            next: () => nextChange(signal),
        }),
    };
}

//
// Searches for paths for `fs.promises.glob`, which hands them over one at a time.
//
export async function* globForPaths(pattern: unknown, options: unknown): AsyncGenerator<string> {
    for (const found of globSync(pattern, options)) {
        yield found;
    }
}

//
// A temporary directory that removes itself, as `fs.promises.mkdtempDisposable` hands it back.
//
export interface IAsyncDisposableDirectory {
    //
    // Where the directory is.
    //
    path: string;

    //
    // Removes it and everything in it.
    //
    remove(): Promise<void>;

    //
    // The same, for `await using`.
    //
    [Symbol.asyncDispose](): Promise<void>;
}

//
// Makes a temporary directory that removes itself, for `fs.promises.mkdtempDisposable`.
//
export function mkdtempDisposableAsync(prefix: unknown, options: unknown): IAsyncDisposableDirectory {
    const made = mkdtempDisposableSync(prefix, options);
    return {
        path: made.path,
        remove: async () => made.remove(),
        [Symbol.asyncDispose]: async () => made.remove(),
    };
}

//
// Refuses `fs.promises.lchmod` as Node refuses it on Linux.
//
export function lchmodRefused(): Promise<never> {
    return Promise.reject(lchmodMissing());
}

//
// Searches for paths for `fs.promises.glob`, in the run's tree, or on the disk with no run in
// flight.
//
export function globPromise(pattern: unknown, options: unknown): AsyncIterable<unknown> {
    if (tree() === undefined) {
        const found = realCall(real.promises, "glob")(pattern, options);
        assert(isAsyncIterable(found));
        return found;
    }
    return globForPaths(pattern, options);
}

//
// Watches a path for `fs.promises.watch`, in the run's tree, or on the disk with no run in flight.
//
export function watchPromise(file: unknown, options: unknown): AsyncIterable<unknown> {
    if (tree() === undefined) {
        const watching = realCall(real.promises, "watch")(file, options);
        assert(isAsyncIterable(watching));
        return watching;
    }
    return watchForChanges(options);
}

//
// The promise half, which `node:fs/promises` is and `fs.promises` holds.
//
export const promises = {
    access: promiseForm("access", accessSync),
    appendFile: promiseForm("appendFile", abortable(appendFileSync, 2)),
    chmod: promiseForm("chmod", chmodSync),
    chown: promiseForm("chown", chownSync),
    copyFile: promiseForm("copyFile", copyFileSync),
    cp: promiseForm("cp", cpSync),
    glob: globPromise,
    lchmod: promiseForm("lchmod", lchmodRefused),
    lchown: promiseForm("lchown", lchownSync),
    link: promiseForm("link", linkSync),
    lstat: promiseForm("lstat", lstatSync),
    lutimes: promiseForm("lutimes", lutimesSync),
    mkdir: promiseForm("mkdir", mkdirSync),
    mkdtemp: promiseForm("mkdtemp", mkdtempSync),
    mkdtempDisposable: promiseForm("mkdtempDisposable", mkdtempDisposableAsync),
    open: promiseForm("open", openHandle),
    opendir: promiseForm("opendir", opendirSync),
    readFile: promiseForm("readFile", abortable(readFileSync, 1)),
    readdir: promiseForm("readdir", readdirSync),
    readlink: promiseForm("readlink", readlinkSync),
    realpath: promiseForm("realpath", realpathSync),
    rename: promiseForm("rename", renameSync),
    rm: promiseForm("rm", rmSync),
    rmdir: promiseForm("rmdir", rmdirSync),
    stat: promiseForm("stat", statSync),
    statfs: promiseForm("statfs", statfsSync),
    symlink: promiseForm("symlink", symlinkSync),
    truncate: promiseForm("truncate", truncateSync),
    unlink: promiseForm("unlink", unlinkSync),
    utimes: promiseForm("utimes", utimesSync),
    watch: watchPromise,
    writeFile: promiseForm("writeFile", abortable(writeFileSync, 2)),
    constants: real.constants,
};

//
// The real module's constants, which reach no disk.
//
export const constants = real.constants;

//
// The number `access` takes to ask whether a path is there, which Node also gives outside its
// constants.
//
export const F_OK = real.constants.F_OK;

//
// The number `access` takes to ask whether a path can be read.
//
export const R_OK = real.constants.R_OK;

//
// The number `access` takes to ask whether a path can be written.
//
export const W_OK = real.constants.W_OK;

//
// The number `access` takes to ask whether a path can be run.
//
export const X_OK = real.constants.X_OK;

//
// Linux has no `lchmod`, so Node gives the name with no call behind it. Code that checks for it
// before calling finds no call here either.
//
export const lchmod = undefined;

//
// The same for the synchronous form.
//
export const lchmodSync = undefined;

//
// Node's helper that turns a time into the seconds its calls take, which reaches no disk. It is
// read by name because Node's types do not declare it.
//
export const _toUnixTimestamp: unknown = Reflect.get(real, "_toUnixTimestamp");

//
// The older names Node still gives the stream classes.
//
export { ReadStream as FileReadStream, WriteStream as FileWriteStream };

//
// What `import fs from "node:fs"` gets: every name the real module gives, each call replaced.
//
export default {
    readFileSync,
    writeFileSync,
    appendFileSync,
    existsSync,
    statSync,
    lstatSync,
    accessSync,
    readdirSync,
    mkdirSync,
    mkdtempSync,
    mkdtempDisposableSync,
    rmdirSync,
    rmSync,
    unlinkSync,
    renameSync,
    copyFileSync,
    cpSync,
    symlinkSync,
    linkSync,
    readlinkSync,
    realpathSync,
    chmodSync,
    chownSync,
    lchownSync,
    utimesSync,
    lutimesSync,
    truncateSync,
    openSync,
    closeSync,
    readSync,
    writeSync,
    readvSync,
    writevSync,
    fstatSync,
    ftruncateSync,
    fsyncSync,
    fdatasyncSync,
    fchmodSync,
    fchownSync,
    futimesSync,
    statfsSync,
    globSync,
    opendirSync,
    access,
    appendFile,
    chmod,
    chown,
    close,
    copyFile,
    cp,
    fchmod,
    fchown,
    fdatasync,
    fstat,
    fsync,
    ftruncate,
    futimes,
    glob,
    lchown,
    link,
    lstat,
    lutimes,
    mkdir,
    mkdtemp,
    open,
    opendir,
    read,
    readdir,
    readFile,
    readlink,
    readv,
    realpath,
    rename,
    rm,
    rmdir,
    stat,
    statfs,
    symlink,
    truncate,
    unlink,
    utimes,
    write,
    writeFile,
    writev,
    exists,
    watch,
    watchFile,
    unwatchFile,
    openAsBlob,
    createReadStream,
    createWriteStream,
    promises,
    Dir,
    Dirent,
    Stats,
    ReadStream,
    WriteStream,
    FileReadStream: ReadStream,
    FileWriteStream: WriteStream,
    Utf8Stream,
    constants,
    F_OK,
    R_OK,
    W_OK,
    X_OK,
    lchmod,
    lchmodSync,
    _toUnixTimestamp,
};
