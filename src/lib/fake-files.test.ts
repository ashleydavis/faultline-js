//
// What the tests build a project out of: a file system in memory, the small library of built-in
// types a program over it is compiled with and the declarations of the sim types.
//
// Its goal is to let every unit test read and write a project without the disk. The method is to
// hold every file, directory and failure in maps and sets, and to answer each call of
// `IFileSystem` from them with a promise, as Node's own calls answer.
//
// Only the tests use this. Its name ends in `.test.ts` so the package leaves it out with every other
// test file, and `jest.config.js` leaves it out of the files Jest runs, because it holds no test of
// its own.
//

import assert from "node:assert/strict";
import path from "node:path";
import type { EntryKind, IDirectoryEntry, IFileSystem } from "./file-system.ts";

//
// A file system in memory that a test can read back and make fail.
//
export interface IFakeFileSystem extends IFileSystem {
    //
    // Every file, by its absolute path, with its text. Writes land here.
    //
    files: Map<string, string>;

    //
    // The directories made with `makeDirectory` that hold no file. A directory that holds a file is
    // there because the file is.
    //
    directories: Set<string>;

    //
    // The paths that are neither a file nor a directory, as a symbolic link is to a walk.
    //
    others: Set<string>;

    //
    // Makes the next access of any kind to `file` reject with the error Node gives with `code`.
    // Each call fails one access.
    //
    failNext(file: string, code: string): void;
}

//
// The error Node gives for `code`, carrying the code, the call and the path the way Node's does.
//
export function nodeError(code: string, syscall: string, file: string): NodeJS.ErrnoException {
    const error: NodeJS.ErrnoException = new Error(`${code}: the fake file system failed, ${syscall} '${file}'`);
    error.code = code;
    error.syscall = syscall;
    error.path = file;
    return error;
}

//
// Adds the entry of `directory` (ending in a separator) that `file` sits in or under, as `kind`
// when it is the file itself and as a directory when the file is further down.
//
export function addEntry(found: Map<string, IDirectoryEntry>, directory: string, file: string, kind: EntryKind): void {
    if (!file.startsWith(directory)) {
        return;
    }
    const rest = file.slice(directory.length);
    const separator = rest.indexOf(path.sep);
    if (separator === -1) {
        found.set(rest, {
            name: rest,
            kind,
        });
        return;
    }
    const name = rest.slice(0, separator);
    found.set(name, {
        name,
        kind: "directory",
    });
}

//
// What a file system in memory holds: its files, its empty directories, its other entries and the
// failures waiting for each path.
//
export interface IFakeState {
    //
    // Every file, by its absolute path, with its text.
    //
    files: Map<string, string>;

    //
    // The directories made that hold no file.
    //
    directories: Set<string>;

    //
    // The paths that are neither a file nor a directory.
    //
    others: Set<string>;

    //
    // The Node error codes the next accesses of each path fail with, in order.
    //
    failures: Map<string, string[]>;
}

//
// The failure waiting for the next access of `file`, taken off its list, or undefined when none is.
//
export function takeFailure(state: IFakeState, file: string, syscall: string): NodeJS.ErrnoException | undefined {
    assert(path.isAbsolute(file), `${file} is not an absolute path.`);
    const waiting = state.failures.get(file);
    if (!waiting) {
        return undefined;
    }
    if (waiting.length === 0) {
        return undefined;
    }
    const code = waiting.shift();
    assert(code);
    return nodeError(code, syscall, file);
}

//
// A promise of `value`, or of the failure Node would give, so the fake answers the way the real
// calls do without throwing.
//
export function settle<Value>(value: Value | NodeJS.ErrnoException): Promise<Value> {
    if (value instanceof Error) {
        return Promise.reject(value);
    }
    return Promise.resolve(value);
}

//
// Whether `directory` is a directory: the root, a directory made or one something sits under.
//
export function isFakeDirectory(state: IFakeState, directory: string): boolean {
    if (directory === path.parse(directory).root) {
        return true;
    }
    if (state.directories.has(directory)) {
        return true;
    }
    const inside = `${directory}${path.sep}`;
    return [...state.files.keys(), ...state.directories, ...state.others].some((file) => file.startsWith(inside));
}

//
// The entries of `directory`, sorted by name, or the error Node gives for it.
//
export function listFake(state: IFakeState, directory: string): IDirectoryEntry[] | NodeJS.ErrnoException {
    const failure = takeFailure(state, directory, "scandir");
    if (failure) {
        return failure;
    }
    if (state.files.has(directory)) {
        return nodeError("ENOTDIR", "scandir", directory);
    }
    if (!isFakeDirectory(state, directory)) {
        return nodeError("ENOENT", "scandir", directory);
    }
    const inside = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
    const found = new Map<string, IDirectoryEntry>();
    for (const file of state.files.keys()) {
        addEntry(found, inside, file, "file");
    }
    for (const made of state.directories) {
        addEntry(found, inside, made, "directory");
    }
    for (const other of state.others) {
        addEntry(found, inside, other, "other");
    }
    return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
}

//
// The text of `file`, or the error Node gives for it.
//
export function readFake(state: IFakeState, file: string): string | NodeJS.ErrnoException {
    const failure = takeFailure(state, file, "open");
    if (failure) {
        return failure;
    }
    const text = state.files.get(file);

    //
    // A file can hold no text, so an empty string is a file and only a missing one is not.
    //
    if (text === undefined) {
        return nodeError(isFakeDirectory(state, file) ? "EISDIR" : "ENOENT", "open", file);
    }
    return text;
}

//
// Whether `file` is a file, as `stat` would tell, or the failure waiting for it.
//
export function isFakeFile(state: IFakeState, file: string): boolean | NodeJS.ErrnoException {
    const failure = takeFailure(state, file, "stat");
    if (failure) {
        return failure;
    }
    return state.files.has(file);
}

//
// Whether `directory` is a directory, as `stat` would tell, or the failure waiting for it.
//
export function isFakeDirectoryStat(state: IFakeState, directory: string): boolean | NodeJS.ErrnoException {
    const failure = takeFailure(state, directory, "stat");
    if (failure) {
        return failure;
    }
    if (state.files.has(directory)) {
        return false;
    }
    return isFakeDirectory(state, directory);
}

//
// Where `file` leads, which is itself because the fake holds no links, or the error Node gives.
//
export function realPathFake(state: IFakeState, file: string): string | NodeJS.ErrnoException {
    const failure = takeFailure(state, file, "realpath");
    if (failure) {
        return failure;
    }
    if (state.files.has(file)) {
        return file;
    }
    if (isFakeDirectory(state, file)) {
        return file;
    }
    return nodeError("ENOENT", "realpath", file);
}

//
// Writes `text` to `file`, or gives the error Node gives when its directory is not there.
//
export function writeFake(state: IFakeState, file: string, text: string): undefined | NodeJS.ErrnoException {
    const failure = takeFailure(state, file, "open");
    if (failure) {
        return failure;
    }
    if (!isFakeDirectory(state, path.dirname(file))) {
        return nodeError("ENOENT", "open", file);
    }
    state.files.set(file, text);
    return undefined;
}

//
// Moves `from` to `to`, replacing what was there, or gives the error Node gives when `from` is not
// there.
//
export function renameFake(state: IFakeState, from: string, to: string): undefined | NodeJS.ErrnoException {
    const failure = takeFailure(state, to, "rename");
    if (failure) {
        return failure;
    }
    const text = state.files.get(from);
    if (text === undefined) {
        return nodeError("ENOENT", "rename", from);
    }
    state.files.delete(from);
    state.files.set(to, text);
    return undefined;
}

//
// Makes `directory`, or gives the error Node gives when a file is there.
//
export function makeFake(state: IFakeState, directory: string): undefined | NodeJS.ErrnoException {
    const failure = takeFailure(state, directory, "mkdir");
    if (failure) {
        return failure;
    }
    if (state.files.has(directory)) {
        return nodeError("EEXIST", "mkdir", directory);
    }
    state.directories.add(directory);
    return undefined;
}

//
// Whether `file` is `directory` itself or sits anywhere under it.
//
export function isAtOrUnder(file: string, directory: string): boolean {
    if (file === directory) {
        return true;
    }
    return file.startsWith(`${directory}${path.sep}`);
}

//
// Removes `directory` and everything under it from every set of `state` that holds paths, or gives
// the failure waiting for it.
//
export function removeFake(state: IFakeState, directory: string): undefined | NodeJS.ErrnoException {
    const failure = takeFailure(state, directory, "rm");
    if (failure) {
        return failure;
    }
    for (const file of [...state.files.keys()]) {
        if (isAtOrUnder(file, directory)) {
            state.files.delete(file);
        }
    }
    for (const paths of [state.directories, state.others]) {
        for (const file of [...paths]) {
            if (isAtOrUnder(file, directory)) {
                paths.delete(file);
            }
        }
    }
    return undefined;
}

//
// Makes the next access of `file` fail with `code`, after any failures already waiting for it.
//
export function addFailure(state: IFakeState, file: string, code: string): void {
    const waiting = state.failures.get(file) ?? [];
    waiting.push(code);
    state.failures.set(file, waiting);
}

//
// Builds a file system in memory holding `files`, by absolute path.
//
export function createFakeFileSystem(files: Record<string, string>): IFakeFileSystem {
    const state: IFakeState = {
        files: new Map(),
        directories: new Set(),
        others: new Set(),
        failures: new Map(),
    };
    for (const [file, text] of Object.entries(files)) {
        assert(path.isAbsolute(file), `${file} is not an absolute path.`);
        state.files.set(file, text);
    }
    return {
        files: state.files,
        directories: state.directories,
        others: state.others,
        failNext: (file: string, code: string) => addFailure(state, file, code),
        readText: (file: string) => settle(readFake(state, file)),
        isFile: (file: string) => settle(isFakeFile(state, file)),
        isDirectory: (directory: string) => settle(isFakeDirectoryStat(state, directory)),
        listDirectory: (directory: string) => settle(listFake(state, directory)),
        realPath: (file: string) => settle(realPathFake(state, file)),
        writeText: (file: string, text: string) => settle(writeFake(state, file, text)),
        rename: (from: string, to: string) => settle(renameFake(state, from, to)),
        makeDirectory: (directory: string) => settle(makeFake(state, directory)),
        removeDirectory: (directory: string) => settle(removeFake(state, directory)),
    };
}

//
// The built-in types a program over a project in memory is compiled with, in place of TypeScript's
// own library files, so no test reads them from `node_modules`. It declares only what the tests
// name, the browser's and Node's types among them, and the project's `tsconfig.json` sets `noLib`
// and names it in `types`.
//
export const testLibrary = `
interface Object {}
interface Function {
    apply(this: Function, thisArg: any, argArray?: any): any;
    call(this: Function, thisArg: any, ...argArray: any[]): any;
    readonly name: string;
}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {
    [index: number]: any;
    length: number;
}
interface String {
    readonly length: number;
    startsWith(searchString: string): boolean;
    endsWith(searchString: string): boolean;
    includes(searchString: string): boolean;
    slice(start?: number, end?: number): string;
    toUpperCase(): string;
    trim(): string;
}
interface Number {
    toFixed(digits?: number): string;
}
interface Boolean {}
interface Symbol {}
interface RegExp {
    test(text: string): boolean;
}
interface TemplateStringsArray extends ReadonlyArray<string> {}
interface ReadonlyArray<T> {
    readonly length: number;
    readonly [index: number]: T;
    includes(searchElement: T): boolean;
    map<U>(callback: (value: T, index: number) => U): U[];
}
interface Array<T> {
    length: number;
    [index: number]: T;
    push(...items: T[]): number;
    includes(searchElement: T): boolean;
    map<U>(callback: (value: T, index: number) => U): U[];
    filter(predicate: (value: T, index: number) => unknown): T[];
    join(separator?: string): string;
}
interface ArrayConstructor {
    new <T>(...items: T[]): T[];
    isArray(arg: any): arg is any[];
}
declare var Array: ArrayConstructor;
interface PromiseLike<T> {
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2>;
}
interface Promise<T> {
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2>;
}
interface PromiseConstructorLike {
    new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): PromiseLike<T>;
}
interface PromiseConstructor {
    new <T>(executor: (resolve: (value: T) => void, reject: (reason?: any) => void) => void): Promise<T>;
    resolve<T>(value: T): Promise<T>;
}
declare var Promise: PromiseConstructor;
interface Error {
    name: string;
    message: string;
    stack?: string;
}
interface ErrorConstructor {
    new (message?: string): Error;
}
declare var Error: ErrorConstructor;
interface TypeError extends Error {}
declare var TypeError: { new (message?: string): TypeError };
interface RangeError extends Error {}
declare var RangeError: { new (message?: string): RangeError };
interface ReadonlyMap<K, V> {
    get(key: K): V | undefined;
    readonly size: number;
}
interface Map<K, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): this;
    has(key: K): boolean;
    readonly size: number;
}
declare var Map: { new <K, V>(): Map<K, V> };
interface ReadonlySet<T> {
    has(value: T): boolean;
    readonly size: number;
}
interface Set<T> {
    add(value: T): this;
    has(value: T): boolean;
    readonly size: number;
}
declare var Set: { new <T>(): Set<T> };
interface Date {
    getTime(): number;
}
declare var Date: { new (value?: number | string): Date; now(): number };
interface ArrayBuffer {
    readonly byteLength: number;
}
declare var ArrayBuffer: { new (byteLength: number): ArrayBuffer };
interface Uint8Array {
    readonly length: number;
    [index: number]: number;
}
declare var Uint8Array: { new (length: number): Uint8Array };
interface AbortSignal {
    readonly aborted: boolean;
}
interface URL {
    readonly href: string;
}
declare var URL: { new (url: string): URL };
interface Buffer extends Uint8Array {}
declare var Buffer: { from(text: string): Buffer };
interface HTMLElement {
    id: string;
    parentElement: HTMLElement | null;
    ownerDocument: Document;
}
interface Document {
    body: HTMLElement;
    defaultView: Window;
}
interface Window {
    document: Document;
    window: Window;
}
interface JSON {
    parse(text: string): any;
    stringify(value: any): string;
}
declare var JSON: JSON;
interface Math {
    random(): number;
}
declare var Math: Math;
interface Console {
    log(...data: any[]): void;
}
declare var console: Console;
declare function setTimeout(handler: () => void, timeout?: number): number;
type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type NonNullable<T> = T & {};
type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
`;

//
// The sim types as Faultline's package declares them, which a sim file in a project in memory
// imports from `faultline`. Discovery tells a scenario and an expectation function by the file
// their parameter's type is declared in, so every project in memory holds its own copy.
//
export const simDeclarations = `
export interface IFaults {
    readonly injected: number;
}
export interface IScenarioContext {
    readonly faults: IFaults;
    load(path: string): Promise<Record<string, unknown>>;
    expect(condition: boolean, expectation: string): void;
}
export interface IExpectationContext {
    expect(condition: boolean, expectation: string): void;
}
export type Faults = IFaults;
export type ScenarioContext = IScenarioContext;
export type ExpectationContext = IExpectationContext;
`;

//
// The root every project in memory sits at. It is built from the root of the working directory, so
// it is an absolute path on every operating system the tests run on.
//
export const projectRoot = path.join(path.parse(process.cwd()).root, "project");

//
// Where a project in memory has the sim types declared, as discovery is told it.
//
export const simTypesFile = path.join(projectRoot, "node_modules", "faultline", "index.d.ts");

//
// The `tsconfig.json` of a project in memory: the module settings a sim file needs to find
// `faultline`, the library above and nothing else.
//
export const testConfig = `{
    "compilerOptions": {
        "target": "ES2022",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "noLib": true,
        "types": ["test-library"]
    }
}
`;

//
// The files of a project in memory at `projectRoot`: a `package.json`, the `tsconfig.json` above,
// the library, the sim types and `files`, each by its path relative to the root. A file in `files`
// with the name of one of these replaces it.
//
export function projectFiles(files: Record<string, string>): Record<string, string> {
    const written: Record<string, string> = {
        [path.join(projectRoot, "package.json")]: `{
    "name": "fixture",
    "type": "module"
}
`,
        [path.join(projectRoot, "tsconfig.json")]: testConfig,
        [path.join(projectRoot, "node_modules", "@types", "test-library", "index.d.ts")]: testLibrary,
        [simTypesFile]: simDeclarations,
    };
    for (const [name, text] of Object.entries(files)) {
        written[path.join(projectRoot, name)] = text;
    }
    return written;
}

//
// A file system in memory holding a project at `projectRoot` made of `files`, as `projectFiles`
// writes it.
//
export function createFakeProject(files: Record<string, string>): IFakeFileSystem {
    return createFakeFileSystem(projectFiles(files));
}
