// The simulated standard input, output and error of one run.
//
// Output the code under test writes is kept and not shown, so a run prints nothing of its own and a
// scenario can read what was written. The input ends with no data. Every write to output and the
// first read of input are places, where the stream can fail as `docs/FAILURES.md` lists.

import { Readable, Writable } from "node:stream";
import { fileError } from "./effects.ts";
import type { Injector } from "./injector.ts";

// What `process.stdout` and `process.stderr` are while a run is in flight.
export class RunOutput extends Writable {
    // Everything written to the stream, in order.
    private kept = "";

    // What decides which writes go wrong.
    private readonly injector: Injector;

    // The number Node gives the stream, one for output and two for error.
    readonly fd: number;

    // Whether the stream is a terminal. It is not, so code under test writes no colours.
    readonly isTTY = false;

    constructor(injector: Injector, fd: number) {
        super({
            decodeStrings: false,
        });
        this.injector = injector;
        this.fd = fd;
    }

    // Takes one write, or fails it the way the injector says: an error emitted on the stream, or a
    // write that is kept but asks the caller to wait for `drain`.
    override write(chunk: unknown, encoding?: unknown, callback?: unknown): boolean {
        const done = typeof encoding === "function" ? encoding : callback;
        const failure = this.injector.check("standard-stream", ["input-or-output-error", "output-closed", "short-write"]);
        if (failure === "input-or-output-error" || failure === "output-closed") {
            const error = fileError(failure === "output-closed" ? "EPIPE" : "EIO", "write", this.fd === 1 ? "stdout" : "stderr");
            queueMicrotask(() => {
                if (typeof done === "function") {
                    done(error);
                }
                this.emit("error", error);
            });
            return false;
        }
        this.keep(chunk);
        if (typeof done === "function") {
            queueMicrotask(() => done(null));
        }
        if (failure === "short-write") {
            queueMicrotask(() => this.emit("drain"));
            return false;
        }
        return true;
    }

    // Keeps what was written without asking the injector, for a write that cannot fail, such as
    // what `console` writes: Node's console takes no notice of a failing stream.
    keep(chunk: unknown): void {
        this.kept += typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8");
    }

    // Everything written to the stream.
    written(): string {
        return this.kept;
    }

    // What a stream that is not a terminal answers when asked how many colours it has.
    getColorDepth(): number {
        return 1;
    }

    // Whether the stream shows colours, which a stream that is not a terminal does not.
    hasColors(): boolean {
        return false;
    }
}

// What `process.stdin` is while a run is in flight.
export class RunInput extends Readable {
    // What decides whether the read goes wrong.
    private readonly injector: Injector;

    // The number Node gives the stream.
    readonly fd = 0;

    // Whether the stream is a terminal, which it is not.
    readonly isTTY = false;

    constructor(injector: Injector) {
        super();
        this.injector = injector;
    }

    // Ends the input, or fails it with `EIO` when the injector says so.
    override _read(): void {
        const failure = this.injector.check("standard-stream", ["input-closed", "input-or-output-error"]);
        if (failure === "input-or-output-error") {
            this.destroy(fileError("EIO", "read", "stdin"));
            return;
        }
        this.push(null);
    }
}
