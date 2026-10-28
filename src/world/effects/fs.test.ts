//
// Tests for the replacement of `node:fs`.
//
// The goal is to show four things. With a run in flight every call, in its synchronous, callback
// and promise forms, answers from the run's own tree and never reaches the disk. The planned
// failure reaches the call at its place. A synchronous call with no run in flight crashes rather
// than block on the disk. With no run in flight every other call is handed to the real module. The
// method is to put a run in flight, call the replacement the way code under test calls `node:fs`
// and read back what the tree holds. The real module is replaced here by
// stand-ins that touch no disk, so with no run in flight the test checks each call is handed on
// with the same arguments and its answer handed back.
//

import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { promisify } from "node:util";
import { describe, jest, test } from "@jest/globals";
import { isCodedError } from "../../lib/file-system.ts";
import { runWith } from "../current.ts";
import type { PlannedFailure } from "../injector.ts";
import { RunSubject } from "../subject.ts";
import * as named from "./fs.ts";
import files, {
    abortable,
    asAsked,
    asBytes,
    byteCountAnswer,
    byteView,
    byteViews,
    callbackForm,
    Dir,
    direntAt,
    directoryClosed,
    Dirent,
    encodingNamed,
    encodingOf,
    EntryOfKind,
    existsPromise,
    FileHandle,
    flagLetters,
    flagOf,
    FSWatcher,
    globForPaths,
    globPromise,
    invalidArgument,
    isApiCall,
    isAsyncIterable,
    isEncoding,
    isList,
    isMissingEntry,
    isRecord,
    lchmodMissing,
    lchmodRefused,
    listedNames,
    mkdtempDisposableAsync,
    modeOf,
    nextChange,
    noAnswer,
    oneAnswer,
    openHandle,
    optionsOf,
    pathText,
    positionOf,
    promiseForm,
    readRequest,
    readRest,
    ReadStream,
    realCall,
    realExists,
    refuseAborted,
    relativeName,
    Stats,
    statsOf,
    statWith,
    textEncodingOf,
    thrownError,
    timeOf,
    tree,
    treeFor,
    unknownEncoding,
    Utf8Stream,
    watchForChanges,
    watchPromise,
    withCode,
    writeAll,
    writeRequest,
    WriteStream,
} from "./fs.ts";
import filePromises from "./fs-promises.ts";

//
// The stand-ins as the test reads them back: each call by name, with the promise half's.
//
export interface IMockedFileModule {
    //
    // The promise half's stand-ins.
    //
    promises: Record<string, jest.Mock>;

    //
    // Every other stand-in, by name.
    //
    [name: string]: jest.Mock | Record<string, jest.Mock>;
}

//
// The real module as the stand-ins below are built from: its calls by name, with its promise half.
//
export interface IFileModule {
    //
    // The promise half.
    //
    promises: Record<string, unknown>;

    //
    // Everything else, by name.
    //
    [name: string]: unknown;
}

//
// The stream classes, as the stand-ins below make the streams the real module would hand back.
//
export interface IStreamModule {
    //
    // A stream read from.
    //
    Readable: typeof Readable;

    //
    // A stream written to.
    //
    Writable: typeof Writable;
}

//
// The event emitter, as the stand-ins below make the watchers the real module would hand back.
//
export interface IEventsModule {
    //
    // What a watcher is.
    //
    EventEmitter: typeof EventEmitter;
}

//
// The real module with every call that reaches the disk replaced by a stand-in that answers with a
// value naming itself. A stand-in that hands back a stream, a watcher, a blob or something read
// with `for await` hands back one of those, so the replacement can check what it was handed. The
// classes and constants are kept. The temporary directories that remove themselves are stood in for
// too, because the Node on the path running the tests can be older than the one that added them.
//
jest.mock("node:fs", () => {
    const actual = jest.requireActual<IFileModule>("node:fs");
    const streams = jest.requireActual<IStreamModule>("node:stream");
    const events = jest.requireActual<IEventsModule>("node:events");
    const replaced: Record<string, unknown> = {
        ...actual,
    };
    for (const [name, value] of Object.entries(actual)) {
        if (typeof value === "function" && /^[a-z]/.test(name)) {
            replaced[name] = jest.fn(() => `real ${name}`);
        }
    }
    replaced.mkdtempDisposableSync = jest.fn(() => "real mkdtempDisposableSync");
    replaced.createReadStream = jest.fn(() => streams.Readable.from(["real createReadStream"]));
    replaced.createWriteStream = jest.fn(() => new streams.Writable());
    replaced.watch = jest.fn(() => new events.EventEmitter());
    replaced.watchFile = jest.fn(() => new events.EventEmitter());
    replaced.openAsBlob = jest.fn(async () => new Blob(["real openAsBlob"]));
    replaced.exists = jest.fn((...args: unknown[]) => {
        const done = args[1];
        if (typeof done === "function") {
            done(true);
        }
        return "real exists";
    });
    const promised: Record<string, unknown> = {
        ...actual.promises,
    };
    for (const [name, value] of Object.entries(promised)) {
        if (typeof value === "function") {
            promised[name] = jest.fn(async () => `real promises.${name}`);
        }
    }
    for (const name of ["mkdtempDisposable", "lchmod"]) {
        promised[name] = jest.fn(async () => `real promises.${name}`);
    }
    for (const name of ["glob", "watch"]) {
        promised[name] = jest.fn(() => streams.Readable.from([`real promises.${name}`]));
    }
    replaced.promises = promised;
    return replaced;
});

//
// The stand-ins above, as the test reads them back.
//
const realModule = jest.requireMock<IMockedFileModule>("node:fs");

//
// The real module's own functions, which the replacement has to differ from.
//
const actualModule = jest.requireActual<IFileModule>("node:fs");

//
// The value an assertion that a call fails compares the error with: the `code` Node gives it.
//
export interface IErrorCode {
    //
    // The code.
    //
    code: string;
}

//
// The value an assertion that a call fails compares the error with: its name.
//
export interface IErrorName {
    //
    // The name.
    //
    name: string;
}

//
// What an error carrying `code` is compared with.
//
export function errorCoded(code: string): IErrorCode {
    return {
        code,
    };
}

//
// What an error called `name` is compared with.
//
export function errorNamed(name: string): IErrorName {
    return {
        name,
    };
}

//
// The code of an error Node or the tree raised.
//
export function codeOf(error: unknown): string | undefined {
    assert.ok(isCodedError(error), `${String(error)} is not an error with a code.`);
    return error.code;
}

//
// The options that ask a call to go into every directory below.
//
const recursively = {
    recursive: true,
};

//
// Runs `work` with one run in flight and waits for it, so the replaced filesystem answers from
// that run's tree. The tree holds `/settings.json` and `/notes.txt`, written with injection off.
//
export async function whileRunning<Answer>(work: (subject: RunSubject) => Answer | Promise<Answer>, planned: PlannedFailure | undefined): Promise<Answer> {
    const subject = new RunSubject(7, planned);
    subject.injector.setInjecting(false);
    subject.files.writeFile("/settings.json", Buffer.from('{"retries":3}'), false, false);
    subject.files.writeFile("/notes.txt", Buffer.from("first\nsecond\n"), false, false);
    subject.injector.setInjecting(true);
    const before = runWith(subject);
    try {
        return await work(subject);
    }
    finally {
        runWith(before);
    }
}

//
// The failure planned for the first call of `effect`.
//
export function firstCallOf(effect: PlannedFailure["place"]["effect"], failure: string): PlannedFailure {
    return {
        place: {
            effect,
            occurrence: 0,
        },
        failure,
    };
}

//
// A callback form called the way code under test calls it, as a promise of what it handed the
// callback.
//
export function calledBack(call: (...args: unknown[]) => unknown, ...args: unknown[]): Promise<unknown[]> {
    return new Promise((settle) => {
        call(...args, (...answer: unknown[]) => settle(answer));
    });
}

//
// Every piece a stream or an async iterable hands over, in order.
//
export async function readAll(stream: AsyncIterable<unknown>): Promise<unknown[]> {
    const pieces: unknown[] = [];
    for await (const piece of stream) {
        pieces.push(piece);
    }
    return pieces;
}

//
// The pieces a stream handed over, joined as text.
//
export function joined(pieces: unknown[]): string {
    return pieces.map((piece) => (Buffer.isBuffer(piece) ? piece.toString("utf8") : String(piece))).join("");
}

//
// Calls the method `key` of `owner`, which the test reads as a value of unknown type, then hands
// back what it hands back.
//
export function callMethod(owner: unknown, key: PropertyKey): unknown {
    assert.ok(isRecord(owner), `${String(owner)} is not an object.`);
    const method: unknown = Reflect.get(owner, key);
    assert.ok(isApiCall(method), `${String(owner)} has no method ${String(key)}.`);
    return Reflect.apply(method, owner, []);
}

//
// The stats a call handed back, which a call given no option to say otherwise always hands back.
//
export function statsGiven(stats: Stats | undefined): Stats {
    assert.ok(stats instanceof Stats);
    return stats;
}

//
// Whether a listing is a list of entries.
//
export function isDirentList(value: unknown): value is Dirent[] {
    if (!isList(value)) {
        return false;
    }
    return value.every((entry) => entry instanceof Dirent);
}

//
// The arguments a stand-in was last called with, copied out of the mock's own realm.
//
export function lastCall(stand: jest.Mock): unknown[] {
    return Array.from(stand.mock.lastCall ?? []);
}

//
// The stand-in of the synchronous or callback call `name`.
//
export function standInOf(name: string): jest.Mock {
    const found = realModule[name];
    assert(typeof found === "function", `node:fs has no stand-in called ${name}.`);
    return found;
}

//
// The function `name` of `owner`, to be called as code under test calls it.
//
export function callOf(owner: object, name: string): (...args: unknown[]) => unknown {
    const found: unknown = Reflect.get(owner, name);
    assert(isApiCall(found), `There is no function ${name}.`);
    return found;
}

//
// A callback a call is handed, which no call answers while the real module is stood in for.
//
export function ignoreAnswer(): void {
    return undefined;
}

describe("what the module replaces", () => {
    //
    // The functions the real module has that read no disk and so are kept as they are.
    //
    const kept = new Set(["_toUnixTimestamp"]);

    test("every function of the real node:fs that reaches the disk is replaced, in the default and the named exports", () => {
        for (const [name, value] of Object.entries(actualModule)) {
            if (typeof value !== "function") {
                continue;
            }
            if (kept.has(name)) {
                continue;
            }
            assert.notEqual(Reflect.get(files, name), value, `fs.${name} is the real one.`);
            assert.notEqual(Reflect.get(named, name), value, `The named export ${name} is the real one.`);
        }
    });

    test("every name of the real node:fs is given, so code that imports one by name finds it", () => {
        for (const name of Object.keys(actualModule)) {
            assert.ok(name in files, `fs.${name} is missing.`);
            assert.ok(name in named, `The named export ${name} is missing.`);
        }
    });

    test("every function of the real node:fs/promises is replaced, in both spellings", () => {
        for (const [name, value] of Object.entries(actualModule.promises)) {
            if (typeof value !== "function") {
                continue;
            }
            assert.notEqual(Reflect.get(files.promises, name), value, `fs.promises.${name} is the real one.`);
            assert.equal(Reflect.get(filePromises, name), Reflect.get(files.promises, name));
        }
    });

    test("the constants are the real ones, and Linux's missing lchmod is missing here too", () => {
        assert.equal(files.constants, actualModule.constants);
        assert.equal(files.F_OK, files.constants.F_OK);
        assert.equal(files.R_OK, files.constants.R_OK);
        assert.equal(files.W_OK, files.constants.W_OK);
        assert.equal(files.X_OK, files.constants.X_OK);
        assert.equal(files.lchmod, undefined);
        assert.equal(files.lchmodSync, undefined);
        assert.equal(files._toUnixTimestamp, actualModule._toUnixTimestamp);
    });
});

describe("isApiCall", () => {
    test("a function is a call and anything else is not", () => {
        assert.equal(isApiCall(ignoreAnswer), true);
        assert.equal(isApiCall("readFile"), false);
    });
});

describe("isRecord", () => {
    test("an object is a record, and null and other values are not", () => {
        assert.equal(isRecord({}), true);
        assert.equal(isRecord(null), false);
        assert.equal(isRecord("text"), false);
    });
});

describe("isList", () => {
    test("an array is a list and anything else is not", () => {
        assert.equal(isList([]), true);
        assert.equal(isList("a"), false);
    });
});

describe("isEncoding", () => {
    test("an encoding Node knows is one, and other text and other values are not", () => {
        assert.equal(isEncoding("utf8"), true);
        assert.equal(isEncoding("base64"), true);
        assert.equal(isEncoding("klingon"), false);
        assert.equal(isEncoding(8), false);
    });
});

describe("isAsyncIterable", () => {
    test("what `for await` can read is async iterable, and other values are not", () => {
        assert.equal(isAsyncIterable(Readable.from([])), true);
        assert.equal(isAsyncIterable({}), false);
        assert.equal(isAsyncIterable("text"), false);
    });
});

describe("realCall", () => {
    test("a call the real module has is handed back bound to it", () => {
        assert.equal(realCall(files, "readFileSync").name.endsWith("readFileSync"), true);
        assert.equal(isApiCall(realCall(files, "readFileSync")), true);
    });

    test("a call the real module lacks is a mistake in this module", () => {
        assert.throws(() => realCall(files, "readEverything"), /The real node:fs has no call readEverything/);
    });
});

describe("tree and treeFor", () => {
    test("with no run in flight there is no tree, and a synchronous call crashes", () => {
        assert.equal(tree(), undefined);
        assert.throws(() => treeFor("readFileSync"), /The code under test called fs.readFileSync with no run in flight/);
    });

    test("with a run in flight the tree is the run's own", async () => {
        await whileRunning((subject) => {
            assert.equal(tree(), subject.files);
            assert.equal(treeFor("readFileSync"), subject.files);
        }, undefined);
    });
});

describe("the errors Node gives", () => {
    test("an error is given the code Node gives the same failure, as a property it lists", () => {
        const error = withCode(new Error("Failed."), "ESOMETHING");
        assert.equal(codeOf(error), "ESOMETHING");
        assert.ok(Object.keys(error).includes("code"));
    });

    test("each error carries Node's code and says what went wrong", () => {
        const wrongType = invalidArgument("path", "of type string", 5);
        assert.ok(wrongType instanceof TypeError);
        assert.equal(codeOf(wrongType), "ERR_INVALID_ARG_TYPE");
        assert.match(wrongType.message, /The "path" argument must be of type string\. Received number\./);
        const encoding = unknownEncoding("klingon");
        assert.equal(codeOf(encoding), "ERR_INVALID_ARG_VALUE");
        assert.match(encoding.message, /Received 'klingon'/);
        assert.equal(codeOf(directoryClosed()), "ERR_DIR_CLOSED");
        assert.equal(codeOf(lchmodMissing()), "ERR_METHOD_NOT_IMPLEMENTED");
    });

    test("what the tree threw is handed on as the error it is, and anything else is a mistake in the tree", () => {
        const error = new Error("Failed.");
        assert.equal(thrownError(error), error);
        assert.throws(() => thrownError("text"), /The tree threw text, which is not an error/);
    });

    test("only an error saying a path is not there is a missing entry", () => {
        assert.equal(isMissingEntry(withCode(new Error("Missing."), "ENOENT")), true);
        assert.equal(isMissingEntry(withCode(new Error("Not a directory."), "ENOTDIR")), false);
        assert.equal(isMissingEntry("ENOENT"), false);
    });
});

describe("pathText", () => {
    test("a path is read from a string, a buffer or a file URL, and anything else is refused", () => {
        assert.equal(pathText("/a"), "/a");
        assert.equal(pathText(Buffer.from("/b")), "/b");
        assert.equal(pathText(new URL("file:///c")), "/c");
        assert.throws(() => pathText(5), errorCoded("ERR_INVALID_ARG_TYPE"));
    });
});

describe("the options a call was given", () => {
    test("an options object is read as it is, an encoding alone is an encoding and anything else is no option", () => {
        const given = {
            flag: "a",
        };
        assert.equal(optionsOf(given), given);
        assert.deepEqual(optionsOf("utf8"), {
            encoding: "utf8",
        });
        assert.deepEqual(optionsOf(undefined), {});
        assert.deepEqual(optionsOf(5), {});
    });

    test("an encoding is the one named, bytes asked for by name, or none, and one Node does not know is refused", () => {
        assert.equal(encodingNamed("hex"), "hex");
        assert.throws(() => encodingNamed("klingon"), errorCoded("ERR_INVALID_ARG_VALUE"));
        assert.equal(encodingOf("utf8"), "utf8");
        assert.equal(encodingOf({
            encoding: "buffer",
        }), "buffer");
        assert.equal(encodingOf({
            encoding: null,
        }), undefined);
        assert.equal(encodingOf(undefined), undefined);
        assert.throws(() => encodingOf("klingon"), errorCoded("ERR_INVALID_ARG_VALUE"));
    });

    test("text is written in the encoding asked for, and in UTF-8 when bytes or no encoding were", () => {
        assert.equal(textEncodingOf("hex"), "hex");
        assert.equal(textEncodingOf("buffer"), "utf8");
        assert.equal(textEncodingOf(undefined), "utf8");
    });

    test("the flags are the letters given, or the ones the call opens with otherwise", () => {
        assert.equal(flagOf({
            flag: "ax",
        }, "w"), "ax");
        assert.equal(flagOf(undefined, "w"), "w");
    });

    test("permission bits are read from a number or from octal text", () => {
        assert.equal(modeOf(0o600, 0o777), 0o600);
        assert.equal(modeOf("755", 0o777), 0o755);
        assert.equal(modeOf(undefined, 0o777), 0o777);
    });

    test("a time is read from a date, or from seconds in a number or in text", () => {
        assert.equal(timeOf(new Date(5000)), 5000);
        assert.equal(timeOf(5), 5000);
        assert.equal(timeOf("5"), 5000);
    });

    test("a read with no position, a null one or a negative one starts where the last ended", () => {
        assert.equal(positionOf(undefined), undefined);
        assert.equal(positionOf(null), undefined);
        assert.equal(positionOf(-1), undefined);
        assert.equal(positionOf(4), 4);
        assert.equal(positionOf(4n), 4);
    });
});

describe("the bytes a call reads and writes", () => {
    test("a read hands back bytes, or text in the encoding asked for", () => {
        const bytes = Buffer.from("hi");
        assert.equal(asAsked(bytes, undefined), bytes);
        assert.equal(asAsked(bytes, "buffer"), bytes);
        assert.equal(asAsked(bytes, "utf8"), "hi");
    });

    test("a write takes text in the encoding asked for or any view of bytes, and refuses anything else", () => {
        assert.deepEqual(asBytes("6869", "hex"), Buffer.from("hi"));
        assert.deepEqual(asBytes("hi", undefined), Buffer.from("hi"));
        assert.deepEqual(asBytes(new Uint16Array([0x6968]), undefined), Buffer.from("hi"));
        assert.throws(() => asBytes(5, undefined), errorCoded("ERR_INVALID_ARG_TYPE"));
    });

    test("a buffer of any kind is read as its bytes, over the same memory", () => {
        const words = new Uint16Array(2);
        const view = byteView(words, "buffer");
        assert.equal(view.byteLength, 4);
        view[0] = 1;
        assert.equal(words[0], 1);
        assert.throws(() => byteView("text", "buffer"), errorCoded("ERR_INVALID_ARG_TYPE"));
    });

    test("the buffers of a gathered read or write are each read as their bytes, and anything else is refused", () => {
        assert.deepEqual(byteViews([Buffer.from("a"), new Uint8Array(2)]).map((view) => view.byteLength), [1, 2]);
        assert.throws(() => byteViews(Buffer.from("a")), errorCoded("ERR_INVALID_ARG_TYPE"));
        assert.throws(() => byteViews(["a"]), errorCoded("ERR_INVALID_ARG_TYPE"));
    });
});

describe("EntryOfKind", () => {
    test("an entry says which of a file, a directory and a link it is, and is never a device, pipe or socket", () => {
        const file = new EntryOfKind("file");
        const directory = new EntryOfKind("directory");
        const link = new EntryOfKind("symlink");
        assert.deepEqual([file.isFile(), file.isDirectory(), file.isSymbolicLink()], [true, false, false]);
        assert.deepEqual([directory.isFile(), directory.isDirectory(), directory.isSymbolicLink()], [false, true, false]);
        assert.deepEqual([link.isFile(), link.isDirectory(), link.isSymbolicLink()], [false, false, true]);
        assert.deepEqual([file.isBlockDevice(), file.isCharacterDevice(), file.isFIFO(), file.isSocket()], [false, false, false, false]);
    });
});

describe("Stats and statsOf", () => {
    test("stats say what an entry is and carry what Node's carry", async () => {
        await whileRunning((subject) => {
            files.symlinkSync("/notes.txt", "/link", "file");
            const file = statsOf(subject.files, subject.files.stat("/notes.txt", true));
            assert.equal(file.isFile(), true);
            assert.equal(file.size, 13);
            assert.equal(file.nlink, 1);
            assert.equal(file.blocks, 1);
            assert.equal(file.mode & 0o170000, 0o100000);
            assert.ok(file.mtime instanceof Date);
            const link = statsOf(subject.files, subject.files.stat("/link", false));
            assert.equal(link.isSymbolicLink(), true);
            assert.equal(link.size, "/notes.txt".length);
        }, undefined);
    });

    test("stats of a path holding no entry, or held by a count of links that is not one, are a mistake", async () => {
        await whileRunning((subject) => {
            assert.throws(() => statsOf(subject.files, {
                path: "/gone",
                entry: undefined,
                followedLink: false,
            }), /which holds no entry/);
            const entry = subject.files.stat("/notes.txt", true).entry;
            assert.ok(entry);
            assert.throws(() => new Stats(entry, -1), assert.AssertionError);
        }, undefined);
    });
});

describe("Dirent and direntAt", () => {
    test("an entry of a listing is named by its last part and placed in the directory above it", async () => {
        await whileRunning((subject) => {
            files.mkdirSync("/top", undefined);
            files.writeFileSync("/top/a.txt", "a", undefined);
            const inner = direntAt(subject.files, "/top/a.txt");
            assert.deepEqual([inner.name, inner.parentPath, inner.path, inner.isFile()], ["a.txt", "/top", "/top", true]);
            const top = direntAt(subject.files, "/top");
            assert.deepEqual([top.name, top.parentPath, top.isDirectory()], ["top", "/", true]);
        }, undefined);
    });

    test("an entry the tree does not hold, a path that is not absolute or a name that is a path is a mistake", async () => {
        await whileRunning((subject) => {
            assert.throws(() => direntAt(subject.files, "/missing"), /which the tree does not hold/);
            assert.throws(() => direntAt(subject.files, "relative"), /is not an absolute path/);
            assert.throws(() => new Dirent("a/b", "/", "file"), /is a path, not the name of one entry/);
            assert.throws(() => new Dirent("", "/", "file"), assert.AssertionError);
        }, undefined);
    });
});

describe("relativeName and listedNames", () => {
    test("a path is named from the directory holding it", () => {
        assert.equal(relativeName("/", "/a/b"), "a/b");
        assert.equal(relativeName("/a", "/a/b/c"), "b/c");
        assert.throws(() => relativeName("/a", "/b/c"), /is not inside \/a/);
        assert.throws(() => relativeName("/a", "/ab"), assert.AssertionError);
    });

    test("a listing's names are read from the directory its first entry is in", () => {
        assert.deepEqual(listedNames(["/real/a", "/real/b", "/real/b/c"]), ["a", "b", "b/c"]);
        assert.deepEqual(listedNames(["/a"]), ["a"]);
        assert.deepEqual(listedNames([]), []);
    });
});

describe("readRest and writeAll", () => {
    test("the rest of an open file is read, from where the last read ended, past a read that fell short", async () => {
        const rest = await whileRunning((subject) => {
            const number = subject.files.openFile("/notes.txt", "r", 0o666);
            subject.files.readOpen(number, Buffer.alloc(6), 0, 6, undefined);
            return readRest(subject.files, number);
        }, firstCallOf("read", "short-read"));
        assert.equal(rest.toString("utf8"), "first\nsecond\n".slice(3));
    });

    test("every byte is written to an open file, past a write that took only part", async () => {
        const written = await whileRunning((subject) => {
            const number = subject.files.openFile("/out.txt", "w", 0o666);
            writeAll(subject.files, number, Buffer.from("abcdef"));
            return subject.files.readFile("/out.txt").toString("utf8");
        }, firstCallOf("write", "short-write"));
        assert.equal(written, "abcdef");
    });
});

describe("the synchronous calls", () => {
    test("a file is read as bytes, or as text in the encoding asked for", async () => {
        await whileRunning(() => {
            assert.ok(files.readFileSync("/notes.txt", undefined) instanceof Buffer);
            assert.equal(files.readFileSync("/notes.txt", "utf8"), "first\nsecond\n");
            assert.equal(files.readFileSync("/notes.txt", {
                encoding: "base64",
            }), Buffer.from("first\nsecond\n").toString("base64"));
            assert.ok(files.readFileSync("/notes.txt", {
                encoding: "buffer",
            }) instanceof Buffer);
            assert.equal(files.readFileSync(new URL("file:///settings.json"), "utf8"), '{"retries":3}');
            assert.throws(() => files.readFileSync("/notes.txt", "klingon"), errorCoded("ERR_INVALID_ARG_VALUE"));
        }, undefined);
    });

    test("a path no write made is not there, because the tree starts empty", async () => {
        await whileRunning(() => {
            assert.throws(() => files.readFileSync("/etc/hostname", undefined), errorCoded("ENOENT"));
            assert.equal(files.existsSync("/etc/hostname"), false);
            assert.equal(files.existsSync("/notes.txt"), true);
        }, undefined);
    });

    test("a path Node cannot read as a path is not there", async () => {
        await whileRunning(() => {
            assert.equal(files.existsSync(42), false);
            assert.equal(files.existsSync(new URL("http://example.com/notes.txt")), false);
        }, undefined);
    });

    test("what is written is read back, in each kind of data and each flag", async () => {
        await whileRunning(() => {
            files.writeFileSync("/a.txt", "text", undefined);
            files.writeFileSync("/b.txt", new Uint8Array([104, 105]), undefined);
            files.writeFileSync("/c.txt", "68656c6c6f", {
                encoding: "hex",
            });
            files.appendFileSync("/a.txt", " more", undefined);
            files.writeFileSync("/a.txt", " and more", {
                flag: "a",
            });
            assert.equal(files.readFileSync("/a.txt", "utf8"), "text more and more");
            assert.equal(files.readFileSync("/b.txt", "utf8"), "hi");
            assert.equal(files.readFileSync("/c.txt", "utf8"), "hello");
            assert.throws(() => files.writeFileSync("/a.txt", "x", {
                flag: "wx",
            }), errorCoded("EEXIST"));
            assert.throws(() => files.appendFileSync("/a.txt", "x", {
                flag: "ax",
            }), errorCoded("EEXIST"));
            assert.throws(() => files.writeFileSync("/d.txt", 5, undefined), errorCoded("ERR_INVALID_ARG_TYPE"));
        }, undefined);
    });

    test("an open file is read and written whole through its number", async () => {
        await whileRunning(() => {
            const written = files.openSync("/fd.txt", "w+", undefined);
            files.writeFileSync(written, "through the number", undefined);
            files.appendFileSync(written, "!", undefined);
            const read = files.openSync("/fd.txt", "r", undefined);
            assert.equal(files.readFileSync(read, "utf8"), "through the number!");
        }, undefined);
    });

    test("a gathered write that is written short stops at the piece written short", async () => {
        const written = await whileRunning(() => {
            const number = files.openSync("/short.txt", "w", undefined);
            return [files.writevSync(number, [Buffer.from("abcd"), Buffer.from("ef")], undefined), files.readFileSync("/short.txt", "utf8")];
        }, firstCallOf("write", "short-write"));
        assert.deepEqual(written, [2, "ab"]);
    });

    test("a gathered read that is read short stops at the piece read short", async () => {
        const read = await whileRunning(() => {
            const number = files.openSync("/notes.txt", "r", undefined);
            return files.readvSync(number, [Buffer.alloc(4), Buffer.alloc(4)], 0);
        }, firstCallOf("read", "short-read"));
        assert.equal(read, 2);
    });

    test("a planned failure reaches the call at its place", async () => {
        await whileRunning(() => {
            assert.throws(() => files.readFileSync("/settings.json", undefined), errorCoded("EACCES"));
            assert.equal(files.readFileSync("/settings.json", "utf8"), '{"retries":3}');
        }, firstCallOf("file-open", "access-denied"));
    });

    test("stats say what an entry is, following a link or not, and a missing path answers as asked", async () => {
        await whileRunning(() => {
            files.mkdirSync("/d", undefined);
            files.symlinkSync("/notes.txt", "/link", "file");
            const file = statsGiven(files.statSync("/notes.txt", undefined));
            assert.equal(file.isFile(), true);
            assert.equal(statsGiven(files.statSync("/d", undefined)).isDirectory(), true);
            assert.equal(statsGiven(files.lstatSync("/link", undefined)).isSymbolicLink(), true);
            assert.equal(statsGiven(files.statSync("/link", undefined)).isFile(), true);
            assert.equal(files.statSync("/missing", {
                throwIfNoEntry: false,
            }), undefined);
            assert.equal(files.lstatSync("/missing", {
                throwIfNoEntry: false,
            }), undefined);
            assert.throws(() => files.statSync("/missing", undefined), errorCoded("ENOENT"));
            assert.throws(() => files.statSync("/notes.txt/x", {
                throwIfNoEntry: false,
            }), errorCoded("ENOTDIR"));
            files.accessSync("/notes.txt", undefined);
            assert.throws(() => files.accessSync("/missing", undefined), errorCoded("ENOENT"));
        }, undefined);
    });

    test("a directory lists its names, its entries, everything below it or its names as bytes, sorted", async () => {
        await whileRunning(() => {
            files.mkdirSync("/top/inner", recursively);
            files.writeFileSync("/top/b.txt", "b", undefined);
            files.writeFileSync("/top/a.txt", "a", undefined);
            files.writeFileSync("/top/inner/c.txt", "c", undefined);
            files.symlinkSync("/top/a.txt", "/top/link", "file");
            assert.deepEqual(files.readdirSync("/top", undefined), ["a.txt", "b.txt", "inner", "link"]);
            assert.deepEqual(files.readdirSync("/top", recursively), ["a.txt", "b.txt", "inner", "link", "inner/c.txt"]);
            assert.deepEqual(files.readdirSync("/top", {
                encoding: "buffer",
            }), ["a.txt", "b.txt", "inner", "link"].map((name) => Buffer.from(name)));
            const entries = files.readdirSync("/top", {
                withFileTypes: true,
            });
            assert.ok(isDirentList(entries));
            assert.deepEqual(entries.map((entry) => [entry.name, entry.parentPath, entry.isFile(), entry.isDirectory(), entry.isSymbolicLink()]), [
                ["a.txt", "/top", true, false, false],
                ["b.txt", "/top", true, false, false],
                ["inner", "/top", false, true, false],
                ["link", "/top", false, false, true],
            ]);
            const rootEntries = files.readdirSync("/", {
                withFileTypes: true,
            });
            assert.ok(isDirentList(rootEntries));
            assert.deepEqual(rootEntries.map((entry) => entry.parentPath), ["/", "/", "/"]);
            assert.deepEqual(files.readdirSync("/", recursively).slice(0, 2), ["notes.txt", "settings.json"]);
        }, undefined);
    });

    test("a directory reached through a link lists its names from the link", async () => {
        await whileRunning(() => {
            files.mkdirSync("/real/inner", recursively);
            files.writeFileSync("/real/inner/a.txt", "a", undefined);
            files.symlinkSync("/real", "/linked", "dir");
            assert.deepEqual(files.readdirSync("/linked", undefined), ["inner"]);
            assert.deepEqual(files.readdirSync("/linked", recursively), ["inner", "inner/a.txt"]);
            assert.deepEqual(files.readdirSync("/real/inner", undefined), ["a.txt"]);
        }, undefined);
    });

    test("directories are made, made recursively and made temporary", async () => {
        await whileRunning(() => {
            assert.equal(files.mkdirSync("/one", undefined), undefined);
            assert.equal(files.mkdirSync("/two/three", recursively), "/two");
            assert.equal(files.mkdirSync("/two/three", recursively), undefined);
            assert.equal(files.mkdirSync("/four", 0o700), undefined);
            assert.equal(files.mkdirSync("/five", "755"), undefined);
            assert.equal(files.mkdirSync("/six", {
                mode: 0o750,
            }), undefined);
            assert.equal(statsGiven(files.statSync("/four", undefined)).mode & 0o777, 0o700);
            assert.equal(statsGiven(files.statSync("/five", undefined)).mode & 0o777, 0o755);
            assert.equal(statsGiven(files.statSync("/six", undefined)).mode & 0o777, 0o750);
            const temporary = files.mkdtempSync("/one/t-", undefined);
            assert.match(temporary, /^\/one\/t-[A-Za-z0-9]{6}$/);
            const disposable = files.mkdtempDisposableSync("/one/d-", undefined);
            assert.equal(files.existsSync(disposable.path), true);
            disposable.remove();
            assert.equal(files.existsSync(disposable.path), false);
            const disposed = files.mkdtempDisposableSync("/one/e-", undefined);
            disposed[Symbol.dispose]();
            assert.equal(files.existsSync(disposed.path), false);
        }, undefined);
    });

    test("files, directories and trees are removed", async () => {
        await whileRunning(() => {
            files.mkdirSync("/tree/inner", recursively);
            files.writeFileSync("/tree/inner/a.txt", "a", undefined);
            files.mkdirSync("/empty", undefined);
            files.unlinkSync("/notes.txt");
            files.rmdirSync("/empty", undefined);
            assert.throws(() => files.rmdirSync("/tree", undefined), errorCoded("ENOTEMPTY"));
            files.rmSync("/missing", {
                force: true,
            });
            assert.throws(() => files.rmSync("/missing", undefined), errorCoded("ENOENT"));
            files.rmSync("/settings.json", undefined);
            files.mkdirSync("/tree2/inner", recursively);
            files.rmdirSync("/tree2", recursively);
            files.rmSync("/tree", recursively);
            assert.deepEqual(files.readdirSync("/", undefined), []);
        }, undefined);
    });

    test("files are renamed and copied, trees copied, links made and read", async () => {
        await whileRunning(() => {
            files.renameSync("/notes.txt", "/moved.txt");
            files.copyFileSync("/moved.txt", "/copied.txt", undefined);
            assert.throws(() => files.copyFileSync("/moved.txt", "/copied.txt", files.constants.COPYFILE_EXCL), errorCoded("EEXIST"));
            files.mkdirSync("/src/inner", recursively);
            files.writeFileSync("/src/inner/a.txt", "a", undefined);
            files.cpSync("/src", "/dst", recursively);
            assert.equal(files.readFileSync("/dst/inner/a.txt", "utf8"), "a");
            files.symlinkSync("moved.txt", "/soft", "file");
            files.linkSync("/moved.txt", "/hard");
            assert.equal(files.readlinkSync("/soft", undefined), "moved.txt");
            assert.deepEqual(files.readlinkSync("/soft", {
                encoding: "buffer",
            }), Buffer.from("moved.txt"));
            assert.equal(files.realpathSync("/soft", undefined), "/moved.txt");
            assert.equal(files.realpathSync.native("/soft", undefined), "/moved.txt");
            assert.deepEqual(files.realpathSync("/soft", "buffer"), Buffer.from("/moved.txt"));
            assert.equal(files.readFileSync("/hard", "utf8"), "first\nsecond\n");
            assert.equal(statsGiven(files.statSync("/hard", undefined)).nlink, 2);
        }, undefined);
    });

    test("permissions, owners, times and lengths are changed", async () => {
        await whileRunning(() => {
            files.symlinkSync("/notes.txt", "/link", "file");
            files.chmodSync("/notes.txt", 0o600);
            files.chownSync("/notes.txt", 5, 6);
            files.lchownSync("/link", 7, 8);
            files.utimesSync("/notes.txt", 100, new Date(200000));
            files.lutimesSync("/link", "300", 400);
            const stats = statsGiven(files.statSync("/notes.txt", undefined));
            assert.equal(stats.mode & 0o777, 0o600);
            assert.deepEqual([stats.uid, stats.gid], [5, 6]);
            assert.deepEqual([stats.atimeMs, stats.mtimeMs], [100000, 200000]);
            files.truncateSync("/notes.txt", 5);
            assert.equal(statsGiven(files.statSync("/notes.txt", undefined)).size, 5);
            const link = statsGiven(files.lstatSync("/link", undefined));
            assert.deepEqual([link.uid, link.gid, link.atimeMs, link.mtimeMs], [7, 8, 300000, 400000]);
            files.truncateSync("/notes.txt", undefined);
            assert.equal(statsGiven(files.statSync("/notes.txt", undefined)).size, 0);
        }, undefined);
    });

    test("open files are read and written in each way Node is called, and changed through their number", async () => {
        await whileRunning(() => {
            const number = files.openSync("/open.txt", "w+", undefined);
            assert.equal(files.writeSync(number, "hello", undefined, undefined, undefined), 5);
            assert.equal(files.writeSync(number, Buffer.from("XY"), 0, 2, 0), 2);
            assert.equal(files.writeSync(number, Buffer.from("--!"), {
                offset: 2,
                length: 1,
                position: 5,
            }, undefined, undefined), 1);
            assert.equal(files.writeSync(number, "?", 6, "utf8", undefined), 1);
            assert.equal(files.writeSync(number, Buffer.from("!"), {
                position: 5,
            }, undefined, undefined), 1);
            assert.equal(files.writeSync(number, Buffer.from("!"), {}, undefined, undefined), 1);
            assert.equal(files.writeSync(number, Buffer.from("?"), undefined, undefined, undefined), 1);
            assert.equal(files.writeSync(number, Buffer.from("-a"), 1, undefined, undefined), 1);
            files.writeSync(number, Buffer.from("XY"), 0, 2, 0);
            assert.equal(files.writevSync(number, [Buffer.from("a"), Buffer.from("b")], 7), 2);
            assert.equal(files.writevSync(number, [Buffer.from("c")], 9), 1);
            const into = Buffer.alloc(10);
            assert.equal(files.readSync(number, into, 0, 10, 0), 10);
            assert.equal(into.toString("utf8"), "XYllo!?abc");
            assert.equal(files.readSync(number, into, {
                offset: 0,
                length: 2,
                position: 2,
            }, undefined, undefined), 2);
            assert.equal(into.subarray(0, 2).toString("utf8"), "ll");
            //
            // The writes that named no position left the file's position after the eighth byte.
            //
            assert.equal(files.readSync(number, into, {
                position: null,
            }, undefined, undefined), 2);
            assert.equal(files.readSync(number, into, null, null, -1), 0);
            const first = Buffer.alloc(2);
            const second = Buffer.alloc(20);
            assert.equal(files.readvSync(number, [first, second], 0), 10);
            assert.equal(files.readvSync(number, [Buffer.alloc(1)], undefined), 0);
            assert.equal(files.fstatSync(number, undefined).size, 10);
            files.ftruncateSync(number, 4);
            files.ftruncateSync(number, undefined);
            files.fsyncSync(number);
            files.fdatasyncSync(number);
            files.fchmodSync(number, 0o640);
            files.fchownSync(number, 1, 2);
            files.futimesSync(number, 10, 20);
            const stats = files.fstatSync(number, undefined);
            assert.deepEqual([stats.size, stats.mode & 0o777, stats.uid, stats.gid, stats.mtimeMs], [0, 0o640, 1, 2, 20000]);
            files.closeSync(number);
            assert.throws(() => files.closeSync(number), errorCoded("EBADF"));
        }, undefined);
    });

    test("a write given text in an encoding Node does not know is refused", async () => {
        await whileRunning(() => {
            const number = files.openSync("/open.txt", "w", undefined);
            assert.throws(() => files.writeSync(number, "x", 0, "klingon", undefined), errorCoded("ERR_INVALID_ARG_VALUE"));
        }, undefined);
    });

    test("open takes its flags as letters or as numbers", async () => {
        await whileRunning(() => {
            const { O_WRONLY, O_RDWR, O_APPEND, O_EXCL, O_CREAT } = files.constants;
            const appending = files.openSync("/notes.txt", O_WRONLY | O_APPEND, undefined);
            files.writeSync(appending, "third\n", undefined, undefined, undefined);
            assert.equal(files.readFileSync("/notes.txt", "utf8"), "first\nsecond\nthird\n");
            assert.throws(() => files.openSync("/notes.txt", O_CREAT | O_EXCL | O_WRONLY, undefined), errorCoded("EEXIST"));
            const both = files.openSync("/new.txt", O_CREAT | O_RDWR, undefined);
            files.writeSync(both, "x", undefined, undefined, undefined);
            files.writevSync(both, [Buffer.from("y")], undefined);
            assert.equal(files.readFileSync("/new.txt", "utf8"), "xy");
            files.openSync("/notes.txt", O_RDWR, undefined);
            files.openSync("/notes.txt", undefined, undefined);
            assert.throws(() => files.openSync("/missing", 0, undefined), errorCoded("ENOENT"));
        }, undefined);
    });

    test("statfs says there is room, and glob finds paths by pattern in sorted order", async () => {
        await whileRunning(() => {
            assert.ok(files.statfsSync("/", undefined).bavail > 0);
            files.mkdirSync("/src/lib", recursively);
            files.writeFileSync("/src/lib/b.ts", "", undefined);
            files.writeFileSync("/src/a.ts", "", undefined);
            files.writeFileSync("/src/a.js", "", undefined);
            assert.deepEqual(files.globSync("src/**/*.ts", undefined), ["src/a.ts", "src/lib/b.ts"]);
            assert.deepEqual(files.globSync(["*.ts", "lib/*.ts"], {
                cwd: "/src",
            }), ["a.ts", "lib/b.ts"]);
            assert.deepEqual(files.globSync("*.ts", {
                cwd: "/missing",
            }), []);
            assert.throws(() => files.globSync("*", {
                cwd: "/notes.txt",
            }), errorCoded("ENOTDIR"));
        }, undefined);
    });

    test("a gathered read or write given no list of buffers is refused", async () => {
        await whileRunning(() => {
            const number = files.openSync("/notes.txt", "r+", undefined);
            assert.throws(() => files.readvSync(number, Buffer.alloc(1), undefined), errorCoded("ERR_INVALID_ARG_TYPE"));
            assert.throws(() => files.writevSync(number, "text", undefined), errorCoded("ERR_INVALID_ARG_TYPE"));
            assert.throws(() => files.readSync(number, "text", undefined, undefined, undefined), errorCoded("ERR_INVALID_ARG_TYPE"));
        }, undefined);
    });
});

describe("statWith", () => {
    test("a missing path is answered with undefined only when the call asks for that", async () => {
        await whileRunning((subject) => {
            assert.ok(statWith(subject.files, "/notes.txt", true, undefined) instanceof Stats);
            assert.equal(statWith(subject.files, "/missing", true, {
                throwIfNoEntry: false,
            }), undefined);
            assert.throws(() => statWith(subject.files, "/missing", false, undefined), errorCoded("ENOENT"));
        }, undefined);
    });
});

describe("flagLetters", () => {
    test("flags are read as letters, from Node's numbers, or as reading when given neither", () => {
        const { O_WRONLY, O_RDWR, O_APPEND, O_EXCL, O_CREAT } = files.constants;
        assert.equal(flagLetters("a+"), "a+");
        assert.equal(flagLetters(undefined), "r");
        assert.equal(flagLetters(0), "r");
        assert.equal(flagLetters(O_RDWR), "r+");
        assert.equal(flagLetters(O_WRONLY | O_APPEND), "a");
        assert.equal(flagLetters(O_RDWR | O_APPEND | O_EXCL), "ax+");
        assert.equal(flagLetters(O_CREAT | O_WRONLY | O_EXCL), "wx");
    });
});

describe("readRequest and writeRequest", () => {
    test("a read is asked for with the offset, length and position written out or in an options object", () => {
        const buffer = Buffer.alloc(8);
        assert.deepEqual(readRequest(buffer, 2, 3, 4), {
            into: new Uint8Array(buffer.buffer, buffer.byteOffset, 8),
            offset: 2,
            length: 3,
            position: 4,
        });
        const fromOptions = readRequest(buffer, {
            offset: 1,
        }, undefined, undefined);
        assert.deepEqual([fromOptions.offset, fromOptions.length, fromOptions.position], [1, 7, undefined]);
        const bare = readRequest(buffer, undefined, undefined, undefined);
        assert.deepEqual([bare.offset, bare.length, bare.position], [0, 8, undefined]);
    });

    test("a write is asked for with text, a position and an encoding, or with bytes in either way a read is", () => {
        const text = writeRequest("6869", 3, "hex", undefined);
        assert.deepEqual([Buffer.from(text.bytes).toString("utf8"), text.position], ["hi", 3]);
        const plain = writeRequest("hi", undefined, undefined, undefined);
        assert.deepEqual([Buffer.from(plain.bytes).toString("utf8"), plain.position], ["hi", undefined]);
        const fromOptions = writeRequest(Buffer.from("abc"), {
            offset: 1,
        }, undefined, undefined);
        assert.deepEqual([Buffer.from(fromOptions.bytes).toString("utf8"), fromOptions.position], ["bc", undefined]);
        const written = writeRequest(Buffer.from("abc"), 0, 2, 9);
        assert.deepEqual([Buffer.from(written.bytes).toString("utf8"), written.position], ["ab", 9]);
    });
});

describe("refuseAborted and abortable", () => {
    test("a call given an aborted signal fails with an AbortError while a run is in flight", async () => {
        const controller = new AbortController();
        controller.abort();
        await whileRunning(() => {
            assert.throws(() => refuseAborted({
                signal: controller.signal,
            }), errorNamed("AbortError"));
            refuseAborted({
                signal: new AbortController().signal,
            });
            refuseAborted({
                signal: "not a signal",
            });
            refuseAborted(undefined);
        }, undefined);
    });

    test("with no run in flight a signal is not asked about", () => {
        const controller = new AbortController();
        controller.abort();
        refuseAborted({
            signal: controller.signal,
        });
        assert.equal(tree(), undefined);
    });

    test("an abortable call reads the signal at the place it was told and then makes the call", async () => {
        const controller = new AbortController();
        controller.abort();
        const call = abortable((...args: unknown[]) => args.length, 1);
        await whileRunning(() => {
            assert.equal(call("a", undefined), 2);
            assert.throws(() => call("a", {
                signal: controller.signal,
            }), errorNamed("AbortError"));
        }, undefined);
        assert.throws(() => abortable(ignoreAnswer, 0), assert.AssertionError);
    });
});

describe("the answers a callback is handed", () => {
    test("a callback is handed one value, no value, or a count of bytes and the buffer they went through", () => {
        assert.deepEqual(oneAnswer("value"), ["value"]);
        assert.deepEqual(noAnswer(), []);
        assert.deepEqual(byteCountAnswer(3, [7, "buffer"]), [3, "buffer"]);
        assert.throws(() => byteCountAnswer("three", [7, "buffer"]), assert.AssertionError);
    });
});

describe("callbackForm", () => {
    test("the callback is handed what the call handed back, or the error it threw, after the call is made", async () => {
        const answered = callbackForm("answered", (...args: unknown[]) => args.length, oneAnswer);
        const failing = callbackForm("failing", () => {
            throw new Error("Failed.");
        }, oneAnswer);
        await whileRunning(async () => {
            assert.deepEqual(await calledBack(answered, "a", "b"), [null, 2]);
            const [error] = await calledBack(failing);
            assert.ok(error instanceof Error);
            assert.throws(() => answered("a"), errorCoded("ERR_INVALID_ARG_TYPE"));
        }, undefined);
    });

    test("a synchronous call or an empty name is not a callback form", () => {
        assert.throws(() => callbackForm("readFileSync", ignoreAnswer, noAnswer), /is a synchronous call/);
        assert.throws(() => callbackForm("", ignoreAnswer, noAnswer), assert.AssertionError);
    });
});

describe("promiseForm", () => {
    test("the promise settles with what the call handed back, and a file handle is read as its number", async () => {
        const echoed = promiseForm("echoed", (...args: unknown[]) => args);
        await whileRunning(async () => {
            assert.deepEqual(await echoed("a", 1), ["a", 1]);
            const handle = openHandle("/notes.txt", "r", undefined);
            assert.deepEqual(await echoed(handle, 1), [handle.fd, 1]);
        }, undefined);
    });

    test("a synchronous call or an empty name is not a promise form", () => {
        assert.throws(() => promiseForm("readFileSync", ignoreAnswer), /is a synchronous call/);
        assert.throws(() => promiseForm("", ignoreAnswer), assert.AssertionError);
    });
});

describe("the callback forms", () => {
    test("each callback form hands the callback what its synchronous form hands back", async () => {
        await whileRunning(async () => {
            assert.deepEqual(await calledBack(files.readFile, "/notes.txt", "utf8"), [null, "first\nsecond\n"]);
            assert.deepEqual(await calledBack(files.writeFile, "/a.txt", "a", undefined), [null]);
            assert.deepEqual(await calledBack(files.appendFile, "/a.txt", "b", undefined), [null]);
            assert.deepEqual(await calledBack(files.access, "/a.txt", undefined), [null]);
            assert.deepEqual(await calledBack(files.mkdir, "/d", recursively), [null, "/d"]);
            assert.deepEqual(await calledBack(files.readdir, "/d", undefined), [null, []]);
            assert.deepEqual(await calledBack(files.copyFile, "/a.txt", "/d/a.txt", undefined), [null]);
            assert.deepEqual(await calledBack(files.cp, "/d", "/e", recursively), [null]);
            assert.deepEqual(await calledBack(files.rename, "/e/a.txt", "/e/b.txt"), [null]);
            assert.deepEqual(await calledBack(files.symlink, "/a.txt", "/link", undefined), [null]);
            assert.deepEqual(await calledBack(files.link, "/a.txt", "/hard"), [null]);
            assert.deepEqual(await calledBack(files.readlink, "/link", undefined), [null, "/a.txt"]);
            assert.deepEqual(await calledBack(files.realpath, "/link", undefined), [null, "/a.txt"]);
            assert.deepEqual(await calledBack(files.realpath.native, "/link", undefined), [null, "/a.txt"]);
            const [, stats] = await calledBack(files.stat, "/a.txt", undefined);
            assert.ok(stats instanceof Stats);
            assert.equal(stats.size, 2);
            const [, linkStats] = await calledBack(files.lstat, "/link", undefined);
            assert.ok(linkStats instanceof Stats);
            assert.equal(linkStats.isSymbolicLink(), true);
            const [, room] = await calledBack(files.statfs, "/", undefined);
            assert.ok(isRecord(room));
            assert.equal(room.bsize, 4096);
            assert.deepEqual(await calledBack(files.chmod, "/a.txt", 0o600), [null]);
            assert.deepEqual(await calledBack(files.chown, "/a.txt", 1, 1), [null]);
            assert.deepEqual(await calledBack(files.lchown, "/link", 1, 1), [null]);
            assert.deepEqual(await calledBack(files.utimes, "/a.txt", 1, 1), [null]);
            assert.deepEqual(await calledBack(files.lutimes, "/link", 1, 1), [null]);
            assert.deepEqual(await calledBack(files.truncate, "/a.txt", 1), [null]);
            assert.match(String((await calledBack(files.mkdtemp, "/t-", undefined))[1]), /^\/t-/);
            assert.deepEqual(await calledBack(files.glob, "*.txt", undefined), [null, ["a.txt", "notes.txt"]]);
            const [, number] = await calledBack(files.open, "/a.txt", "r+", undefined);
            const into = Buffer.alloc(1);
            assert.deepEqual(await calledBack(files.read, number, into, 0, 1, 0), [null, 1, into]);
            const out = Buffer.from("z");
            assert.deepEqual(await calledBack(files.write, number, out, 0, 1, 0), [null, 1, out]);
            const pieces = [Buffer.alloc(1)];
            assert.deepEqual(await calledBack(files.readv, number, pieces, 0), [null, 1, pieces]);
            assert.deepEqual(await calledBack(files.writev, number, pieces, 0), [null, 1, pieces]);
            const [, numberStats] = await calledBack(files.fstat, number, undefined);
            assert.ok(numberStats instanceof Stats);
            assert.equal(numberStats.size, 1);
            assert.deepEqual(await calledBack(files.ftruncate, number, 0), [null]);
            assert.deepEqual(await calledBack(files.fsync, number), [null]);
            assert.deepEqual(await calledBack(files.fdatasync, number), [null]);
            assert.deepEqual(await calledBack(files.fchmod, number, 0o600), [null]);
            assert.deepEqual(await calledBack(files.fchown, number, 1, 1), [null]);
            assert.deepEqual(await calledBack(files.futimes, number, 1, 1), [null]);
            assert.deepEqual(await calledBack(files.close, number), [null]);
            const [, opened] = await calledBack(files.opendir, "/d", undefined);
            assert.ok(opened instanceof Dir);
            assert.equal(opened.path, "/d");
            assert.deepEqual(await calledBack(files.unlink, "/hard"), [null]);
            assert.deepEqual(await calledBack(files.rm, "/e", recursively), [null]);
            assert.deepEqual(await calledBack(files.rmdir, "/d", recursively), [null]);
            assert.deepEqual(await calledBack(files.exists, "/a.txt"), [true]);
            assert.deepEqual(await calledBack(files.exists, "/missing"), [false]);
        }, undefined);
    });

    test("a failing callback form hands the callback the error", async () => {
        const [error] = await whileRunning(() => calledBack(files.readFile, "/missing", undefined), undefined);
        assert.equal(codeOf(error), "ENOENT");
    });

    test("a callback form given no callback throws as Node throws", async () => {
        await whileRunning(() => {
            assert.throws(() => files.readFile("/notes.txt"), errorCoded("ERR_INVALID_ARG_TYPE"));
            assert.throws(() => files.exists("/notes.txt", undefined), errorCoded("ERR_INVALID_ARG_TYPE"));
        }, undefined);
    });

    test("a read given a signal that is aborted fails with an AbortError", async () => {
        const controller = new AbortController();
        controller.abort();
        const [error] = await whileRunning(() => calledBack(files.readFile, "/notes.txt", {
            signal: controller.signal,
        }), undefined);
        assert.ok(error instanceof Error);
        assert.equal(error.name, "AbortError");
    });

    test("util.promisify of exists gives whether the path is there", async () => {
        assert.equal(await whileRunning(() => promisify(files.exists)("/notes.txt"), undefined), true);
        assert.equal(await whileRunning(() => existsPromise("/missing"), undefined), false);
    });
});

describe("the promise forms", () => {
    test("each promise form settles with what its synchronous form hands back", async () => {
        await whileRunning(async () => {
            const promises = files.promises;
            assert.equal(await promises.readFile("/notes.txt", "utf8"), "first\nsecond\n");
            await promises.writeFile("/a.txt", "a", undefined);
            await promises.appendFile("/a.txt", "b", undefined);
            await promises.access("/a.txt", undefined);
            assert.equal(await promises.mkdir("/d", recursively), "/d");
            assert.deepEqual(await promises.readdir("/d", undefined), []);
            await promises.copyFile("/a.txt", "/d/a.txt", undefined);
            await promises.cp("/d", "/e", recursively);
            await promises.rename("/e/a.txt", "/e/b.txt");
            await promises.symlink("/a.txt", "/link", undefined);
            await promises.link("/a.txt", "/hard");
            assert.equal(await promises.readlink("/link", undefined), "/a.txt");
            assert.equal(await promises.realpath("/link", undefined), "/a.txt");
            const stats = await promises.stat("/a.txt", undefined);
            assert.ok(stats instanceof Stats);
            assert.equal(stats.size, 2);
            const linkStats = await promises.lstat("/link", undefined);
            assert.ok(linkStats instanceof Stats);
            assert.equal(linkStats.isSymbolicLink(), true);
            const room = await promises.statfs("/", undefined);
            assert.ok(isRecord(room));
            assert.equal(room.bsize, 4096);
            await promises.chmod("/a.txt", 0o600);
            await promises.chown("/a.txt", 1, 1);
            await promises.lchown("/link", 1, 1);
            await promises.utimes("/a.txt", 1, 1);
            await promises.lutimes("/link", 1, 1);
            await promises.truncate("/a.txt", 1);
            assert.match(String(await promises.mkdtemp("/t-", undefined)), /^\/t-/);
            const disposable = await promises.mkdtempDisposable("/u-", undefined);
            await callMethod(disposable, "remove");
            const disposed = await promises.mkdtempDisposable("/v-", undefined);
            await callMethod(disposed, Symbol.asyncDispose);
            assert.ok(isRecord(disposed));
            assert.equal(files.existsSync(disposed.path), false);
            await assert.rejects(promises.lchmod("/a.txt", 0o600), errorCoded("ERR_METHOD_NOT_IMPLEMENTED"));
            assert.deepEqual(await readAll(promises.glob("*.txt", undefined)), ["a.txt", "notes.txt"]);
            const directory = await promises.opendir("/d", undefined);
            assert.ok(directory instanceof Dir);
            assert.equal(directory.path, "/d");
            await promises.unlink("/hard");
            await promises.rm("/e", recursively);
            await promises.rmdir("/d", recursively);
            assert.equal(promises.constants, files.constants);
        }, undefined);
    });

    test("a failing promise form rejects with the error", async () => {
        await whileRunning(async () => {
            await assert.rejects(files.promises.readFile("/missing", undefined), errorCoded("ENOENT"));
            await assert.rejects(files.promises.writeFile("/notes.txt", "x", undefined), errorCoded("ENOSPC"));
        }, firstCallOf("write", "out-of-space"));
    });

    test("a write given a signal can be aborted at its place", async () => {
        await whileRunning(async () => {
            await assert.rejects(files.promises.writeFile("/a.txt", "x", {
                signal: new AbortController().signal,
            }), errorNamed("AbortError"));
        }, firstCallOf("cancellation", "operation-aborted"));
    });
});

describe("FileHandle and openHandle", () => {
    test("an open file handle reads, writes and changes the file it holds", async () => {
        await whileRunning(async () => {
            const handle = await files.promises.open("/h.txt", "w+", undefined);
            assert.ok(handle instanceof FileHandle);
            assert.equal((await handle.write("hello", undefined, undefined, undefined)).bytesWritten, 5);
            const read = await handle.read(Buffer.alloc(5), 0, 5, 0);
            assert.equal(read.bytesRead, 5);
            assert.equal((await handle.read(undefined, undefined, undefined, undefined)).bytesRead, 0);
            assert.equal((await handle.writev([Buffer.from("!")], 5)).bytesWritten, 1);
            assert.equal((await handle.readv([Buffer.alloc(6)], 0)).bytesRead, 6);
            await handle.appendFile("?", undefined);
            await handle.writeFile("+", undefined);
            //
            // Neither of the two writes is opened to append, so each writes where the last ended.
            //
            assert.equal((await handle.stat()).size, 7);
            await handle.truncate(3);
            await handle.sync();
            await handle.datasync();
            await handle.chmod(0o600);
            await handle.chown(1, 1);
            await handle.utimes(1, 1);
            const second = openHandle("/h.txt", "r", undefined);
            assert.equal(await second.readFile("utf8"), "hel");
            assert.equal(await files.promises.readFile(second, "utf8"), "");
            await second[Symbol.asyncDispose]();
            const closed = once(handle, "close");
            await handle.close();
            await closed;
        }, undefined);
    });

    test("a file handle's reads and writes given an aborted signal fail with an AbortError", async () => {
        const controller = new AbortController();
        controller.abort();
        const aborted = {
            signal: controller.signal,
        };
        await whileRunning(async () => {
            const handle = openHandle("/notes.txt", "r+", undefined);
            await assert.rejects(handle.readFile(aborted), errorNamed("AbortError"));
            await assert.rejects(handle.writeFile("x", aborted), errorNamed("AbortError"));
            await assert.rejects(handle.appendFile("x", aborted), errorNamed("AbortError"));
        }, undefined);
    });

    test("an open file handle makes streams over the file it holds", async () => {
        await whileRunning(async () => {
            const writing = openHandle("/s.txt", "w", undefined);
            const output = writing.createWriteStream({
                autoClose: false,
            });
            output.end("streamed");
            await finished(output);
            const reading = openHandle("/s.txt", "r", undefined);
            assert.equal(joined(await readAll(reading.createReadStream({
                autoClose: false,
            }))), "streamed");
        }, undefined);
    });

    test("a handle on a number no file is held by is a mistake", () => {
        assert.throws(() => new FileHandle(-1), assert.AssertionError);
    });
});

describe("ReadStream and createReadStream", () => {
    test("a read stream hands over the file, from its start to its end, in the encoding asked for", async () => {
        await whileRunning(async () => {
            const stream = files.createReadStream("/notes.txt", {
                start: 6,
                end: 11,
                encoding: "utf8",
                highWaterMark: 2,
                flags: "r",
            });
            assert.ok(stream instanceof ReadStream);
            const opened = once(stream, "open");
            const text = joined(await readAll(stream));
            await opened;
            assert.equal(text, "second");
            assert.equal(stream.bytesRead, 6);
            assert.equal(stream.path, "/notes.txt");
            assert.equal(stream.pending, false);
        }, undefined);
    });

    test("a read stream of an empty file ends with no data, and closing one calls back", async () => {
        await whileRunning(async () => {
            files.writeFileSync("/empty", "", undefined);
            assert.deepEqual(await readAll(files.createReadStream("/empty", undefined)), []);
            const stream = new ReadStream("/notes.txt", undefined);
            await new Promise<void>((done) => {
                stream.close(() => done());
            });
            stream.close(undefined);
            assert.equal(stream.fd, undefined);
        }, undefined);
    });

    test("a read stream that cannot open the file emits the error", async () => {
        await whileRunning(async () => {
            const [error] = await once(files.createReadStream("/missing", undefined), "error");
            assert.equal(codeOf(error), "ENOENT");
        }, undefined);
    });

    test("a read stream that ends early hands over the first half of the file", async () => {
        const text = await whileRunning(async () => joined(await readAll(files.createReadStream("/notes.txt", "utf8"))), firstCallOf("read", "early-end-of-stream"));
        assert.equal(text, "first\n");
    });

    test("a read stream whose read fails emits the error", async () => {
        await whileRunning(async () => {
            const stream = files.createReadStream("/notes.txt", undefined);
            stream.resume();
            const [error] = await once(stream, "error");
            assert.equal(codeOf(error), "EIO");
        }, firstCallOf("read", "input-or-output-error"));
    });

    test("a read stream made on an open file's number has no path and leaves the file open when told to", async () => {
        await whileRunning(async () => {
            const number = files.openSync("/notes.txt", "r", undefined);
            const stream = new ReadStream(undefined, {
                fd: number,
                autoClose: false,
            });
            assert.equal(stream.path, "");
            await readAll(stream);
            assert.equal(stream.fd, number);
            files.closeSync(number);
        }, undefined);
    });

    test("a read stream made with no run in flight is a mistake in the tool", () => {
        assert.throws(() => new ReadStream("/a", {}), /no run in flight/);
    });
});

describe("WriteStream and createWriteStream", () => {
    test("a write stream writes every piece to the tree as it arrives", async () => {
        await whileRunning(async () => {
            const stream = files.createWriteStream("/out.txt", undefined);
            assert.ok(stream instanceof WriteStream);
            stream.write("one ");
            stream.write(Buffer.from("two"));
            stream.end();
            await finished(stream);
            assert.equal(files.readFileSync("/out.txt", "utf8"), "one two");
            assert.equal(stream.bytesWritten, 7);
            assert.equal(stream.path, "/out.txt");
            assert.equal(stream.pending, false);
            const appending = new WriteStream("/out.txt", {
                flags: "a",
                encoding: "utf8",
                mode: 0o600,
            });
            await new Promise<void>((done) => {
                appending.write("!", () => appending.close(() => done()));
            });
            assert.equal(files.readFileSync("/out.txt", "utf8"), "one two!");
            const closing = new WriteStream("/other.txt", undefined);
            closing.close(undefined);
            await finished(closing);
        }, undefined);
    });

    test("a write stream that cannot open or write emits the error", async () => {
        await whileRunning(async () => {
            const [error] = await once(files.createWriteStream("/missing/out.txt", undefined), "error");
            assert.equal(codeOf(error), "ENOENT");
        }, undefined);
        await whileRunning(async () => {
            const stream = files.createWriteStream("/out.txt", undefined);
            stream.write("x");
            const [error] = await once(stream, "error");
            assert.equal(codeOf(error), "ENOSPC");
        }, firstCallOf("write", "out-of-space"));
    });

    test("a write stream made on an open file's number has no path", async () => {
        await whileRunning(async () => {
            const number = files.openSync("/out.txt", "w", undefined);
            const stream = new WriteStream(undefined, {
                fd: number,
            });
            assert.equal(stream.path, "");
            stream.end("x");
            await finished(stream);
            assert.equal(files.readFileSync("/out.txt", "utf8"), "x");
        }, undefined);
    });

    test("a write stream made with no run in flight is a mistake in the tool", () => {
        assert.throws(() => new WriteStream("/a", {}), /no run in flight/);
    });
});

describe("Utf8Stream", () => {
    test("a text stream writes to a file by its path or its number", async () => {
        await whileRunning(async () => {
            const byPath = new Utf8Stream({
                dest: "/log.txt",
            });
            assert.equal(byPath.write("one"), true);
            await new Promise<void>((done) => {
                byPath.flush(() => done());
            });
            byPath.flush(undefined);
            byPath.flushSync();
            const closed = once(byPath, "close");
            byPath.end();
            await closed;
            const number = files.openSync("/log.txt", "a", undefined);
            const byNumber = new Utf8Stream({
                fd: number,
            });
            byNumber.write(" two");
            const replacing = new Utf8Stream({
                dest: "/fresh.txt",
                append: false,
            });
            replacing.write("new");
            assert.equal(files.readFileSync("/log.txt", "utf8"), "one two");
            assert.equal(files.readFileSync("/fresh.txt", "utf8"), "new");
        }, undefined);
    });

    test("a text stream made with no run in flight is a mistake in the tool", () => {
        assert.throws(() => new Utf8Stream({
            dest: "/log.txt",
        }), /no run in flight/);
    });
});

describe("Dir and opendirSync", () => {
    test("entries are read one at a time in sorted order, and a closed directory refuses", async () => {
        await whileRunning(async () => {
            const directory = files.opendirSync("/", undefined);
            assert.equal(directory.readSync()?.name, "notes.txt");
            assert.equal((await directory.read(undefined))?.name, "settings.json");
            assert.equal(await directory.read(undefined), null);
            await directory.close(undefined);
            assert.throws(() => directory.readSync(), errorCoded("ERR_DIR_CLOSED"));
            const closing = directory.close(undefined);
            assert.ok(closing instanceof Promise);
            await assert.rejects(closing, errorCoded("ERR_DIR_CLOSED"));
        }, undefined);
    });

    test("the callback forms of a directory's read and close call back", async () => {
        await whileRunning(async () => {
            const directory = files.opendirSync("/", undefined);
            const [error, entry] = await new Promise<unknown[]>((settle) => {
                directory.read((...answer) => settle(answer));
            });
            assert.equal(error, null);
            assert.ok(entry instanceof Dirent);
            assert.equal(entry.name, "notes.txt");
            await new Promise<void>((done) => {
                directory.close(() => done());
            });
            const [closedError] = await new Promise<unknown[]>((settle) => {
                directory.read((...answer) => settle(answer));
            });
            assert.equal(codeOf(closedError), "ERR_DIR_CLOSED");
            const [againError] = await new Promise<unknown[]>((settle) => {
                directory.close((...answer) => settle(answer));
            });
            assert.equal(codeOf(againError), "ERR_DIR_CLOSED");
        }, undefined);
    });

    test("a directory iterated over is closed after, and one disposed of is closed", async () => {
        await whileRunning(async () => {
            const iterated = files.opendirSync("/", undefined);
            const names = (await readAll(iterated)).map((entry) => (entry instanceof Dirent ? entry.name : "not an entry"));
            assert.deepEqual(names, ["notes.txt", "settings.json"]);
            assert.throws(() => iterated.readSync(), errorCoded("ERR_DIR_CLOSED"));
            const disposed = files.opendirSync("/", undefined);
            disposed[Symbol.dispose]();
            disposed[Symbol.dispose]();
            const asyncDisposed = files.opendirSync("/", undefined);
            await asyncDisposed[Symbol.asyncDispose]();
            const closed = files.opendirSync("/", undefined);
            closed.closeSync();
            await assert.rejects(closed[Symbol.asyncIterator]().next(), errorCoded("ERR_DIR_CLOSED"));
        }, undefined);
    });

    test("a directory left part way through its iteration is closed", async () => {
        await whileRunning(async () => {
            const directory = files.opendirSync("/", undefined);
            for await (const entry of directory) {
                assert.equal(entry.name, "notes.txt");
                break;
            }
            assert.throws(() => directory.readSync(), errorCoded("ERR_DIR_CLOSED"));
        }, undefined);
    });

    test("a listing that fails part way through fails after the first half of its entries", async () => {
        await whileRunning(async () => {
            const directory = files.opendirSync("/", undefined);
            assert.equal(directory.readSync()?.name, "notes.txt");
            assert.throws(() => directory.readSync(), errorCoded("EIO"));
        }, firstCallOf("directory-listing", "error-part-way-through-the-listing"));
    });
});

describe("watching and blobs", () => {
    test("a watcher hears no change, and closing it says so", async () => {
        await whileRunning(async () => {
            let heard = 0;
            const watcher = files.watch("/notes.txt", () => {
                heard += 1;
            }, undefined);
            assert.ok(watcher instanceof FSWatcher);
            assert.equal(watcher.ref(), watcher);
            assert.equal(watcher.unref(), watcher);
            assert.equal(watcher.listenerCount("change"), 1);
            const closed = once(watcher, "close");
            watcher.close();
            await closed;
            assert.equal(files.watch("/notes.txt", {}, ignoreAnswer).listenerCount("change"), 1);
            assert.equal(files.watch("/notes.txt", undefined, undefined).listenerCount("change"), 0);
            assert.ok(files.watchFile("/notes.txt", ignoreAnswer, undefined) instanceof FSWatcher);
            files.unwatchFile("/notes.txt", undefined);
            assert.equal(heard, 0);
        }, undefined);
    });

    test("a file opened as a blob holds the file's bytes and the type asked for", async () => {
        await whileRunning(async () => {
            const blob = await files.openAsBlob("/notes.txt", {
                type: "text/plain",
            });
            assert.equal(await blob.text(), "first\nsecond\n");
            assert.equal(blob.type, "text/plain");
            assert.equal((await files.openAsBlob("/notes.txt", undefined)).type, "");
        }, undefined);
    });

    test("a promise watch hands over no change and ends only when its signal is aborted", async () => {
        await whileRunning(async () => {
            const controller = new AbortController();
            const watching = files.promises.watch("/notes.txt", {
                signal: controller.signal,
            })[Symbol.asyncIterator]();
            const next = watching.next();
            controller.abort();
            await assert.rejects(next, errorNamed("AbortError"));
            const aborted = files.promises.watch("/notes.txt", {
                signal: controller.signal,
            })[Symbol.asyncIterator]();
            await assert.rejects(aborted.next(), errorNamed("AbortError"));
            const forever = files.promises.watch("/notes.txt", undefined)[Symbol.asyncIterator]();
            const settled = await Promise.race([forever.next().then(() => "settled"), new Promise((done) => setImmediate(() => done("waiting")))]);
            assert.equal(settled, "waiting");
        }, undefined);
    });
});

describe("nextChange and watchForChanges", () => {
    test("the next change never comes, and the promise rejects when the signal aborts", async () => {
        const controller = new AbortController();
        const next = nextChange(controller.signal);
        controller.abort();
        await assert.rejects(next, errorNamed("AbortError"));
        await assert.rejects(nextChange(controller.signal), errorNamed("AbortError"));
        const forever = nextChange(undefined).then(() => "settled");
        assert.equal(await Promise.race([forever, new Promise((done) => setImmediate(() => done("waiting")))]), "waiting");
    });

    test("a watch given something other than a signal waits for ever", async () => {
        const forever = watchForChanges({
            signal: "not a signal",
        })[Symbol.asyncIterator]().next().then(() => "settled");
        assert.equal(await Promise.race([forever, new Promise((done) => setImmediate(() => done("waiting")))]), "waiting");
    });
});

describe("globForPaths, globPromise and watchPromise", () => {
    test("a search hands over each path it finds, one at a time", async () => {
        await whileRunning(async () => {
            assert.deepEqual(await readAll(globForPaths("*.json", undefined)), ["settings.json"]);
            assert.deepEqual(await readAll(globPromise("*.txt", undefined)), ["notes.txt"]);
            assert.ok(isAsyncIterable(watchPromise("/notes.txt", undefined)));
        }, undefined);
    });
});

describe("mkdtempDisposableAsync and lchmodRefused", () => {
    test("a temporary directory made for a promise removes itself when removed or disposed of", async () => {
        await whileRunning(async () => {
            const removed = mkdtempDisposableAsync("/r-", undefined);
            assert.equal(files.existsSync(removed.path), true);
            await removed.remove();
            assert.equal(files.existsSync(removed.path), false);
            const disposed = mkdtempDisposableAsync("/s-", undefined);
            await disposed[Symbol.asyncDispose]();
            assert.equal(files.existsSync(disposed.path), false);
        }, undefined);
    });

    test("lchmod is refused as Linux refuses it", async () => {
        await assert.rejects(lchmodRefused(), errorCoded("ERR_METHOD_NOT_IMPLEMENTED"));
    });
});

//
// One call made with no run in flight that is not synchronous: its name and its arguments.
//
export interface IHandedOnCase {
    //
    // The function's name.
    //
    name: string;

    //
    // The arguments it is called with, each of its own so a call handed on with the wrong ones is
    // seen.
    //
    args: unknown[];
}

//
// Every call that is not synchronous and not a callback or promise form, with no run in flight.
//
const handedOnCases: IHandedOnCase[] = [
    {
        name: "createReadStream",
        args: ["/a", 1],
    },
    {
        name: "createWriteStream",
        args: ["/a", 2],
    },
    {
        name: "watch",
        args: ["/a", 3, ignoreAnswer],
    },
    {
        name: "watchFile",
        args: ["/a", 4, ignoreAnswer],
    },
    {
        name: "unwatchFile",
        args: ["/a", ignoreAnswer],
    },
    {
        name: "openAsBlob",
        args: ["/a", 5],
    },
];

//
// The callback forms, each handed to the real callback form of the same name.
//
const callbackNames = [
    "access", "appendFile", "chmod", "chown", "close", "copyFile", "cp", "fchmod", "fchown", "fdatasync", "fstat",
    "fsync", "ftruncate", "futimes", "glob", "lchown", "link", "lstat", "lutimes", "mkdir", "mkdtemp", "open",
    "opendir", "read", "readdir", "readFile", "readlink", "readv", "realpath", "rename", "rm", "rmdir", "stat",
    "statfs", "symlink", "truncate", "unlink", "utimes", "write", "writeFile", "writev", "exists",
];

describe("with no run in flight", () => {
    for (const name of Object.keys(files).filter((one) => one.endsWith("Sync")).filter((one) => isApiCall(Reflect.get(files, one)))) {
        test(`${name} crashes rather than block on the disk, and the real ${name} is never called`, () => {
            assert.throws(() => callOf(files, name)("/a", "b", "c"), new RegExp(`called fs.${name} with no run in flight`));
            assert.equal(standInOf(name).mock.calls.length, 0);
        });
    }

    test("the native form of realpathSync crashes too", () => {
        assert.throws(() => files.realpathSync.native("/a", undefined), /called fs.realpathSync with no run in flight/);
    });

    for (const one of handedOnCases) {
        test(`${one.name} is handed to the real module with its arguments, and its answer comes back`, async () => {
            //
            // A blob is opened asynchronously, so its answer comes back as a promise.
            //
            const answer = await callOf(files, one.name)(...one.args);
            assert.deepEqual(lastCall(standInOf(one.name)), one.args);
            if (one.name === "unwatchFile") {
                assert.equal(answer, undefined);
            }
            else {
                assert.notEqual(answer, undefined);
            }
        });
    }

    test("what the real module hands back is the stream, watcher or blob asked for", async () => {
        assert.deepEqual(await readAll(files.createReadStream("/a", undefined)), ["real createReadStream"]);
        assert.ok(files.createWriteStream("/a", undefined) instanceof Writable);
        assert.ok(files.watch("/a", undefined, undefined) instanceof EventEmitter);
        assert.ok(files.watchFile("/a", undefined, undefined) instanceof EventEmitter);
        assert.equal(await (await files.openAsBlob("/a", undefined)).text(), "real openAsBlob");
    });

    for (const name of callbackNames) {
        test(`the callback form ${name} is handed to the real one with its arguments`, () => {
            assert.equal(callOf(files, name)("/a", "b", ignoreAnswer), undefined);
            assert.deepEqual(lastCall(standInOf(name)), name === "exists" ? ["/a", "b"] : ["/a", "b", ignoreAnswer]);
        });
    }

    test("the native form of realpath is handed to the real realpath", () => {
        files.realpath.native("/n", ignoreAnswer);
        assert.deepEqual(lastCall(standInOf("realpath")), ["/n", ignoreAnswer]);
    });

    test("whether a path is there is asked of the real exists, through util.promisify too", async () => {
        assert.equal(await promisify(files.exists)("/p"), true);
        assert.equal(await realExists("/q"), true);
        assert.equal(lastCall(standInOf("exists"))[0], "/q");
    });

    for (const name of Object.keys(filePromises).filter((one) => !["constants", "glob", "watch"].includes(one))) {
        test(`the promise form ${name} is handed to the real one with its arguments, and its answer comes back`, async () => {
            assert.equal(await callOf(filePromises, name)("/a", "b"), `real promises.${name}`);
            const standIn = realModule.promises[name];
            assert(standIn !== undefined, `node:fs has no promise stand-in called ${name}.`);
            assert.deepEqual(lastCall(standIn), ["/a", "b"]);
        });
    }

    for (const name of ["glob", "watch"]) {
        test(`the promise form ${name} is handed to the real one with its arguments, and what it hands over comes back`, async () => {
            const found = callOf(filePromises, name)("/a", "b");
            assert.ok(isAsyncIterable(found));
            assert.deepEqual(await readAll(found), [`real promises.${name}`]);
            const standIn = realModule.promises[name];
            assert(standIn !== undefined, `node:fs has no promise stand-in called ${name}.`);
            assert.deepEqual(lastCall(standIn), ["/a", "b"]);
        });
    }
});
