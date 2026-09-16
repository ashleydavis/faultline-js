// The effects a run hands the code under test.
//
// Each one answers the way the real thing does until the injector says this call fails, and then
// it fails the way the real thing fails: the error a refused connection throws, the code a missing
// file throws, a write that takes only part of what it was given.

import type { Clock, Files, Net, Writer } from "../runtime/index.ts";
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
export class RunClock implements Clock {
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
export class RunNet implements Net {
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

// A file system a run owns, held in memory. It never touches the disk, so no run can write
// from writing into the repository it is measuring.
export class RunFiles implements Files {
    // Every file this run has, by path.
    private readonly contents = new Map<string, string>();

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
        this.refuse(path, "read");
        const found = this.contents.get(path);
        if (found === undefined) {
            throw new CodedError("ENOENT", `ENOENT: no such file or directory, open '${path}'`);
        }
        return found;
    }

    async readBytes(path: string): Promise<Uint8Array> {
        return new TextEncoder().encode(await this.read(path));
    }

    async write(path: string, contents: string): Promise<void> {
        this.refuse(path, "write");
        this.contents.set(path, contents);
    }

    async exists(path: string): Promise<boolean> {
        this.refuse(path, "stat");
        return this.contents.has(path);
    }

    async list(path: string): Promise<string[]> {
        this.refuse(path, "scandir");
        const prefix = path.endsWith("/") ? path : `${path}/`;
        const names = new Set<string>();
        for (const held of this.contents.keys()) {
            if (held.startsWith(prefix)) {
                names.add(held.slice(prefix.length).split("/")[0]!);
            }
        }
        return [...names].sort();
    }

    async remove(path: string): Promise<void> {
        this.refuse(path, "unlink");
        if (!this.contents.delete(path)) {
            throw new CodedError("ENOENT", `ENOENT: no such file or directory, unlink '${path}'`);
        }
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
    }
}

// A writer a run owns. It keeps what it took, and takes only part of what it was given whenever
// the injector says so, which is the case a caller that ignores the return value gets wrong.
export class RunWriter implements Writer {
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
