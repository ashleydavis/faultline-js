// The effects a run hands the code under test.
//
// Each one answers the way the real thing does until the injector says this call fails, and then
// it fails the way the real thing fails: the error a refused connection throws, the code a missing
// file throws, a write that takes only part of what it was given.

import type { RunInjector } from "./injector.ts";
import type { SeededRng } from "./random.ts";

// An error carrying the same `code` property the Node runtime puts on a failed file operation, so
// code under test that reads `err.code` reads what it would read in production.
export class CodedError extends Error {
    // The code a caller switches on, for example "ENOENT".
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = "Error";
        this.code = code;
    }
}

// A clock a run owns. Time moves only when this clock is asked to move it, so a call that sleeps
// for an hour costs the run no time at all.
export class RunClock {
    // Milliseconds since the epoch, as this clock currently reads.
    private wall: number;

    // Milliseconds since this clock was built, which the run advances but never winds back.
    private elapsed = 0;

    // Builds a clock. The start is fixed rather than read from the machine, so two runs of the
    // same seed read the same times. It is the first second of 2024 in milliseconds.
    // What decides which of this clock's calls go wrong.
    private readonly injector: RunInjector;

    constructor(injector: RunInjector, start = 1704067200000) {
        this.injector = injector;
        this.wall = start;
    }

    now(): number {
        const failure = this.injector.check("clock");
        if (failure === "backwards") {
            // A machine whose clock is corrected while a call is in flight reads earlier than it
            // read a moment ago, which is the case this reproduces. One second is enough to cross
            // any comparison the code under test makes without leaving the same day.
            return this.wall - 1000;
        }
        if (failure === "jump") {
            // The other side of the same correction. An hour is long enough to expire anything the
            // code under test holds a deadline for.
            this.wall += 3600000;
        }
        return this.wall;
    }

    monotonic(): number {
        return this.elapsed;
    }

    async sleep(milliseconds: number): Promise<void> {
        this.advance(milliseconds);
    }

    // Moves this clock forward. A sleep does it, and so does a run between calls.
    advance(milliseconds: number): void {
        const forward = Math.max(0, Math.floor(milliseconds));
        this.wall += forward;
        this.elapsed += forward;
    }
}

// The bodies a network that answers gives back, one of which will not parse. A run hands each of
// them out in turn, so the code that reads a response is exercised against a body it understands
// and a body it does not.
const bodies = ['{"ok":true}', "[]", '{"items":[{"id":1}]}', "", "not json at all"];

// A network a run owns. It answers from a fixed set of bodies until the injector says this call
// fails, and then it fails the way a real network fails.
export class RunNet {
    // How many calls have been answered. This picks the next body.
    private answered = 0;

    // What decides which of this network's calls go wrong.
    private readonly injector: RunInjector;

    // Where the answers this network varies are drawn from.
    private readonly rng: SeededRng;

    constructor(injector: RunInjector, rng: SeededRng) {
        this.injector = injector;
        this.rng = rng;
    }

    async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
        const address = typeof input === "string" ? input : input.toString();
        const failure = this.injector.check("net");
        if (failure === "refused") {
            throw new CodedError("ECONNREFUSED", `connect ECONNREFUSED for ${address}`);
        }
        if (failure === "dns") {
            throw new CodedError("ENOTFOUND", `getaddrinfo ENOTFOUND for ${address}`);
        }
        if (failure === "timeout") {
            throw new CodedError("ETIMEDOUT", `connect ETIMEDOUT for ${address}`);
        }
        if (failure === "server-error") {
            return new Response("upstream is unwell", { status: 503, statusText: "Service Unavailable" });
        }
        if (failure === "bad-body") {
            return new Response("<html>not what was asked for</html>", {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        void init;
        const body = bodies[this.answered % bodies.length]!;
        this.answered += 1;
        // The status is drawn so a run sees more than one answer over its seeds, and stays in the
        // range a caller treats as a success so the working path is the common one.
        const status = this.rng.int(1, 8) === 1 ? 204 : 200;
        return new Response(status === 204 ? null : body, {
            status,
            headers: { "content-type": "application/json" },
        });
    }
}

// What a run reads for a path no write has covered.
//
// The disk is only ever read, and the reading is handed in rather than imported, because this file
// is also bundled for a browser and a browser has no disk. Node's driver puts the real one in and
// a browser run leaves it out.
export interface Beneath {
    // What is at one path on the disk, or nothing when the disk has neither a file nor a directory
    // there.
    kind(path: string): "file" | "directory" | undefined;

    // What the disk holds at one path, or nothing when it holds no file there.
    file(path: string): string | undefined;

    // What the disk holds under one directory, as names, or nothing when it has no directory there.
    names(path: string): string[] | undefined;
}

// The disk every run reads, or nothing where there is none.
let beneath: Beneath | undefined;

// Says what a run reads for a path no write has covered. The driver calls this once, before
// anything is driven.
export function readsBeneath(reader: Beneath | undefined): void {
    beneath = reader;
}

// How many messages a replacement sends a callback it was handed. A file that names hundreds of
// values would have every call send hundreds of messages, and the run works round them a different
// way each turn, so what one call misses the next one sends.
const mostMessages = 48;

// What a replaced module sends a callback the code under test handed it.
//
// A project that registers a handler for a message, a connection or a chunk is handed none by a
// replacement that starts nothing, so the code inside the handler never runs at all. These are what
// the replacements send instead. Each one is built from what the file being measured reads off its
// values and what its own comparisons test against, so a handler that switches on a tag is sent
// every tag the file names.
export class RunEvents {
    // The property names the file being measured reads off its values.
    private properties: string[] = [];

    // The values that file's own comparisons test against.
    private values: (string | number | boolean)[] = [];

    // Which turn this is, so two calls in one run are sent different messages.
    private turn = 0;

    // Says what the file being measured reads and what it tests against.
    holds(properties: string[], values: (string | number | boolean)[], turn = 0): void {
        this.properties = properties;
        this.values = values;
        this.turn = turn;
    }

    // The messages one call sends.
    //
    // Each message puts one value the file tests against under one property it reads, and fills the
    // rest in from the same values. One property is left out of each, because a handler that fills
    // in a default for a property it was not sent is reached no other way.
    messages(): unknown[] {
        const out: unknown[] = [];
        if (this.properties.length === 0 || this.values.length === 0) {
            return out;
        }
        for (let at = 0; at < mostMessages; at += 1) {
            const named = (at + this.turn) % this.properties.length;
            const without = (at + this.turn + 1) % this.properties.length;
            const one: Record<string, unknown> = {};
            for (let which = 0; which < this.properties.length; which += 1) {
                if (which === without && which !== named) {
                    continue;
                }
                one[this.properties[which]!] = this.values[(which + at) % this.values.length];
            }
            one[this.properties[named]!] = this.values[at % this.values.length];
            out.push(one);
        }
        return out;
    }
}

// A file system a run owns. Every write is held in memory and no write reaches the disk, so no run
// can write into the repository it is measuring.
//
// A read is answered from what this run was given, then from the disk, then from a made up file.
// Reading the disk is what lets a project read its own manifest, its own fixture and its own
// template, and a write over one of those is seen by this run alone.
//
// The replaced `node:fs` sits on this, and so does every other way the code under test reaches a
// file, so one run has one tree however the code under test got at it.
export class RunFiles {
    // Every file this run has been given, by path. A path that is not here is looked for on the
    // disk before it is made up.
    private readonly contents = new Map<string, string>();

    // Every path this run has taken away. A file the run removed stays removed even when the disk
    // still has it, so code that removes a file and reads it back reads what it would read.
    private readonly removed = new Set<string>();

    // Every directory this run has been told to make, by path. A file's own directories count as
    // made, so a read after a write works without the directory being made first.
    private readonly directories = new Set<string>(["/"]);

    // Whether the next read hands back something that will not parse. The injector says so, and it
    // is the case a caller that parses without catching gets wrong.
    private unreadable = false;

    // What decides which of these file operations go wrong.
    private readonly injector: RunInjector;

    constructor(injector: RunInjector) {
        this.injector = injector;
        // Two files are there from the start, so a call that reads before it writes has something
        // to read and the working path is reached without a scenario.
        this.contents.set("/settings.json", '{"name":"faultline","retries":3}');
        this.contents.set("/notes.txt", "The first line.\nThe second line.\n");
    }

    async read(path: string): Promise<string> {
        return this.readNow(path);
    }

    async readBytes(path: string): Promise<Uint8Array> {
        return new TextEncoder().encode(await this.read(path));
    }

    async write(path: string, contents: string): Promise<void> {
        this.writeNow(path, contents);
    }

    async exists(path: string): Promise<boolean> {
        return this.existsNow(path);
    }

    async list(path: string): Promise<string[]> {
        return this.listNow(path);
    }

    async remove(path: string): Promise<void> {
        this.removeNow(path);
    }

    // What a path the run was never told about holds.
    //
    // Every path this file system is asked about is there. Which made up string a call was given is
    // an accident, and whether a read fails is the injector's to decide: it fails one, and the
    // exploring reaches every way it can. A tree where only two paths existed meant a read almost
    // always failed, so the code that does something with what it read almost never ran.
    private unasked = '{"name":"faultline","retries":3,"verbose":true}';

    // Says what a path the run was never told about holds. The properties are the ones the file
    // being measured reads, so code that reads a field off what it parsed finds that field there.
    //
    // One property is left out per turn, working round them. A settings file that always held every
    // field the code reads would never reach the code that fills in a default for a missing one,
    // and a field being absent is the commonest thing about a real settings file.
    holds(properties: string[], values: (string | number | boolean)[], turn = 0): void {
        if (properties.length === 0) {
            return;
        }
        const without = turn % (properties.length + 1);
        const out: Record<string, unknown> = {};
        for (let at = 0; at < properties.length; at += 1) {
            if (at === without) {
                continue;
            }
            out[properties[at]!] = values[at % Math.max(values.length, 1)] ?? at;
        }
        this.unasked = JSON.stringify(out);
    }

    // Reads one file, and throws the way the runtime throws when it cannot.
    //
    // A path this run was given is read from what it was given. A path it was not is read from the
    // disk when the disk has it, so a project that reads its own manifest, its own fixture or its
    // own template reads the real one. Only a path neither has is made up.
    readNow(path: string): string {
        this.refuse(path, "open");
        if (this.unreadable) {
            return "<not json at all>";
        }
        const at = clean(path);
        const held = this.contents.get(at);
        if (held !== undefined) {
            return held;
        }
        this.insist(at, "open");
        return this.onDisk(at) ?? this.unasked;
    }

    // What the disk holds at one path, or nothing when it holds no file there.
    //
    // The disk is only ever read. A write goes to this run's own tree and the file the project
    // keeps is left as it was, which is what keeps a run from writing into the repository it is
    // measuring.
    private onDisk(at: string): string | undefined {
        if (this.removed.has(at)) {
            return undefined;
        }
        return beneath?.file(at);
    }

    // Throws the way the runtime throws for a path that is not there.
    private insist(at: string, operation: string): void {
        if (this.isThere(at)) {
            return;
        }
        throw new CodedError("ENOENT", `ENOENT: no such file or directory, ${operation} '${at}'`);
    }

    // What the disk holds under one directory, as names, or nothing when it has no directory there.
    private namesOnDisk(at: string): string[] | undefined {
        return beneath?.names(at);
    }

    // Writes one file, replacing what was there, and makes the directories above it.
    writeNow(path: string, contents: string): void {
        this.refuse(path, "open");
        const at = clean(path);
        this.contents.set(at, contents);
        this.removed.delete(at);
        for (const above of directoriesAbove(at)) {
            this.directories.add(above);
        }
    }

    // Adds to the end of one file, making it when it is not there.
    appendNow(path: string, contents: string): void {
        this.refuse(path, "open");
        const at = clean(path);
        this.contents.set(at, (this.contents.get(at) ?? this.onDisk(at) ?? "") + contents);
        this.removed.delete(at);
        for (const above of directoriesAbove(at)) {
            this.directories.add(above);
        }
    }

    // Whether one path is there at all.
    //
    // A path this run was written to is there, and so is one the disk has. A path neither has is
    // there only when the disk has no directory above it: a run makes up the paths it passes, and a
    // made up path names a tree that is not on this machine, where every path the code under test
    // asks about is one it would have found.
    //
    // A path inside a directory the disk does have is a real path the project does not have.
    // Saying that one was there had the compiler read a TypeScript file at every name it looked
    // for and find a settings file.
    private isThere(at: string): boolean {
        if (this.contents.has(at) || this.directories.has(at)) {
            return true;
        }
        if (this.removed.has(at)) {
            return false;
        }
        if (beneath === undefined) {
            return true;
        }
        if (beneath.kind(at) !== undefined) {
            return true;
        }
        const cut = at.lastIndexOf("/");
        const above = cut <= 0 ? "/" : at.slice(0, cut);
        return beneath.kind(above) !== "directory";
    }

    // Whether a file or a directory is there. A failure the injector asked for answers no rather
    // than throwing, because that is what the runtime does.
    existsNow(path: string): boolean {
        try {
            this.refuse(path, "stat");
        }
        catch {
            return false;
        }
        return this.isThere(clean(path));
    }

    // What one directory holds, as names rather than paths.
    listNow(path: string): string[] {
        this.refuse(path, "scandir");
        const at = clean(path);
        this.insist(at, "scandir");
        const prefix = at === "/" ? "/" : `${at}/`;
        const names = new Set<string>(this.namesOnDisk(at) ?? []);
        for (const held of [...this.contents.keys(), ...this.directories]) {
            if (held !== at && held.startsWith(prefix)) {
                names.add(held.slice(prefix.length).split("/")[0]!);
            }
        }
        for (const gone of this.removed) {
            if (gone.startsWith(prefix) && !gone.slice(prefix.length).includes("/")) {
                names.delete(gone.slice(prefix.length));
            }
        }
        return [...names].sort();
    }

    // Takes one file away. A path the run was never told about is there like any other, so this
    // fails only when the injector fails it.
    removeNow(path: string): void {
        this.refuse(path, "unlink");
        const at = clean(path);
        this.contents.delete(at);
        this.removed.add(at);
    }

    // Makes one directory, and the ones above it.
    makeDirectoryNow(path: string): void {
        this.refuse(path, "mkdir");
        const at = clean(path);
        this.directories.add(at);
        for (const above of directoriesAbove(`${at}/x`)) {
            this.directories.add(above);
        }
    }

    // What one path is, for the code that reads a size or asks whether it is a directory.
    statNow(path: string): { isFile: boolean; isDirectory: boolean; size: number } {
        this.refuse(path, "stat");
        const at = clean(path);
        const held = this.contents.get(at);
        if (held !== undefined) {
            return { isFile: true, isDirectory: false, size: held.length };
        }
        if (this.directories.has(at)) {
            return { isFile: false, isDirectory: true, size: 0 };
        }
        if (beneath?.kind(at) === "directory") {
            return { isFile: false, isDirectory: true, size: 0 };
        }
        const fromDisk = this.onDisk(at);
        if (fromDisk !== undefined) {
            return { isFile: true, isDirectory: false, size: fromDisk.length };
        }
        this.insist(at, "stat");
        // A path the run was never told about is a file holding what a read of it gives back.
        return { isFile: true, isDirectory: false, size: this.unasked.length };
    }

    // Moves one file, keeping what is in it.
    renameNow(from: string, to: string): void {
        const held = this.readNow(from);
        this.writeNow(to, held);
        this.contents.delete(clean(from));
    }

    // Throws the error the injector asked for, and returns when it asked for none.
    private refuse(path: string, operation: string): void {
        const failure = this.injector.check("files");
        if (failure === "missing") {
            throw new CodedError("ENOENT", `ENOENT: no such file or directory, ${operation} '${path}'`);
        }
        if (failure === "denied") {
            throw new CodedError("EACCES", `EACCES: permission denied, ${operation} '${path}'`);
        }
        if (failure === "io") {
            throw new CodedError("EIO", `EIO: i/o error, ${operation} '${path}'`);
        }
        if (failure === "is-directory") {
            throw new CodedError("EISDIR", `EISDIR: illegal operation on a directory, ${operation} '${path}'`);
        }
        if (failure === "full") {
            throw new CodedError("ENOSPC", `ENOSPC: no space left on device, ${operation} '${path}'`);
        }
        if (failure === "unreadable") {
            // The file is there and holds something the caller cannot make sense of. A read gives
            // it back, and the code that handles a settings file somebody has broken runs.
            this.unreadable = true;
            return;
        }
        this.unreadable = false;
    }
}

// One path written the one way, so a read after a write finds what the write put there whichever
// spelling each of them used.
function clean(path: string | URL): string {
    const text = typeof path === "string" ? path : path.pathname;
    const withoutDot = text.replace(/\/\.\//g, "/");
    const trimmed = withoutDot.length > 1 && withoutDot.endsWith("/") ? withoutDot.slice(0, -1) : withoutDot;
    return trimmed === "" ? "/" : trimmed;
}

// Every directory above one path, so a write makes the tree the file sits in.
function directoriesAbove(path: string): string[] {
    const out: string[] = ["/"];
    const pieces = path.split("/").slice(1, -1);
    let held = "";
    for (const piece of pieces) {
        held += `/${piece}`;
        out.push(held);
    }
    return out;
}

// A writer a run owns. It keeps what it took, and takes only part of what it was given whenever
// the injector says so, which is the case a caller that ignores the return value gets wrong.
export class RunWriter {
    // Everything this writer took, in order.
    private taken = "";

    // Whether `end` has been called, after which every write refuses.
    private ended = false;

    // What decides which of these writes go wrong.
    private readonly injector: RunInjector;

    constructor(injector: RunInjector) {
        this.injector = injector;
    }

    async write(text: string): Promise<number> {
        if (this.ended) {
            throw new CodedError("ERR_STREAM_WRITE_AFTER_END", "write after end");
        }
        const failure = this.injector.check("writer");
        if (failure === "closed") {
            this.ended = true;
            throw new CodedError("ERR_STREAM_DESTROYED", "cannot write to a destroyed stream");
        }
        if (failure === "broken-pipe") {
            throw new CodedError("EPIPE", "write EPIPE");
        }
        if (failure === "short" && text.length > 0) {
            // One character, because a caller that assumes the whole string went out is wrong by
            // the largest amount here, so this is the case worth exercising.
            this.taken += text.slice(0, 1);
            return 1;
        }
        this.taken += text;
        return text.length;
    }

    async end(): Promise<void> {
        this.ended = true;
    }

    // Everything this writer took. A scenario asserts on it.
    written(): string {
        return this.taken;
    }
}
