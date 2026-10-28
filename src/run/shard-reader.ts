//
// Reads shards and measures files for the child: what the compiler says about a shard's files and
// where the code paths of a loaded file sit.
//
// The child reads V8's coverage after every call, and a reading costs time for every function and
// object in the isolate, the compiler's included. So the child does this work on a thread of its
// own, whose isolate the child's coverage never reads, and asks it through `ThreadShardReader`.
// `LocalShardReader` does the same work where it is made: on that thread, and in the tests.
//

import assert from "node:assert/strict";
import path from "node:path";
import type { MeasuredFile } from "../coverage/v8.ts";
import type { ILoader } from "../load/hooks.ts";
import { createMeasurer, type IMeasurer } from "./measure.ts";
import { readShard, type IShardReading, type ProgramsByConfig } from "./shard.ts";

//
// Reads shards and measures files.
//
export interface IShardReader extends IMeasurer {
    //
    // Reads the shard `file` with its sim files `sims`, both relative to the project root.
    //
    read(file: string, sims: string[]): Promise<IShardReading>;
}

//
// Reads and measures where it is made, keeping each program for the next shard under its config
// and each file it measured.
//
export class LocalShardReader implements IShardReader {
    //
    // How files are read and transpiled, and the project they belong to.
    //
    private loader: ILoader;

    //
    // The files of the `faultline` package that declare the sim types, by which a scenario and an
    // expectation function are told apart.
    //
    private simTypes: string[];

    //
    // The programs built, each the old program for the next shard under its `tsconfig.json`.
    //
    private programs: ProgramsByConfig;

    //
    // The files measured, each once.
    //
    private measurer: IMeasurer;

    //
    // Builds a reader over `loader` that tells sim functions apart by `simTypes`.
    //
    constructor(loader: ILoader, simTypes: string[]) {
        assert(simTypes.length > 0);
        assert(path.isAbsolute(loader.settings.projectRoot));
        this.loader = loader;
        this.simTypes = simTypes;
        this.programs = new Map();
        this.measurer = createMeasurer(loader);
    }

    //
    // Reads a shard with the compiler.
    //
    read(file: string, sims: string[]): Promise<IShardReading> {
        assert(file.length > 0);
        assert(Array.isArray(sims));
        return readShard(this.loader.reading, this.loader.settings.projectRoot, this.simTypes, file, sims, this.programs);
    }

    //
    // Measures the file a URL names.
    //
    measure(url: string): Promise<MeasuredFile | undefined> {
        assert(url.length > 0);
        assert(!url.includes("?"), `${url} was measured with its query, so every copy of it would be measured again.`);
        return this.measurer.measure(url);
    }
}

//
// One request to the reader's thread. A read names `file` and `sims` and leaves `url` empty; a
// measure names `url` and leaves the others empty.
//
export interface IReaderRequest {
    //
    // The number the reply carries, so it reaches the call that asked.
    //
    id: number;

    //
    // What is asked.
    //
    kind: "read" | "measure";

    //
    // The shard's file, relative to the project root.
    //
    file: string;

    //
    // The shard's sim files, relative to the project root.
    //
    sims: string[];

    //
    // The URL of the file to measure.
    //
    url: string;
}

//
// The reply to one request. `error` is empty when the work was done.
//
export interface IReaderReply {
    //
    // The number of the request it answers.
    //
    id: number;

    //
    // What a read found.
    //
    reading: IShardReading | undefined;

    //
    // What a measure found, undefined too for a URL that names no source file of the project.
    //
    measured: MeasuredFile | undefined;

    //
    // Why the work could not be done, with the stack, or empty when it was.
    //
    error: string;
}

//
// Does what one request asks with `reader` and gives the reply. A failure is put in the reply, so
// the child that asked fails with it rather than waiting for a reply that never comes.
//
export async function answerReaderRequest(reader: IShardReader, request: IReaderRequest): Promise<IReaderReply> {
    assert(Number.isInteger(request.id));
    const reply: IReaderReply = {
        id: request.id,
        reading: undefined,
        measured: undefined,
        error: "",
    };
    try {
        if (request.kind === "read") {
            reply.reading = await reader.read(request.file, request.sims);
        }
        else {
            reply.measured = await reader.measure(request.url);
        }
    }
    catch (error) {
        reply.error = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
        assert(reply.error.length > 0);
    }
    return reply;
}

//
// The end of the channel to the reader's thread that the child holds: `Worker` from
// `node:worker_threads`, or a fake in the tests.
//
export interface IReaderPort {
    //
    // Sends a request to the thread.
    //
    postMessage(request: IReaderRequest): void;

    //
    // Hears each reply from the thread, and an error that ended it.
    //
    on(event: "message" | "error", listener: (value: unknown) => void): void;
}

//
// A request waiting for its reply.
//
export interface IPendingRequest {
    //
    // Hands the reply to the call that asked.
    //
    resolve(reply: IReaderReply): void;

    //
    // Fails the call that asked.
    //
    reject(error: Error): void;
}

//
// Whether a message from the reader's thread is a reply.
//
export function isReaderReply(value: unknown): value is IReaderReply {
    if (typeof value !== "object") {
        return false;
    }
    if (value === null) {
        return false;
    }
    if (!("id" in value)) {
        return false;
    }
    if (!("error" in value)) {
        return false;
    }
    return typeof value.id === "number";
}

//
// Reads and measures on the reader's thread, through `port`.
//
export class ThreadShardReader implements IShardReader {
    //
    // The channel to the thread.
    //
    private port: IReaderPort;

    //
    // The requests sent and not yet answered, by their numbers.
    //
    private pending: Map<number, IPendingRequest>;

    //
    // How many requests have been sent, which numbers the next.
    //
    private sent: number;

    //
    // What each URL measured as, kept on this side, because every reading names the same files
    // again and a round trip to the thread for each would cost more than the reading saves.
    //
    private measured: Map<string, MeasuredFile | undefined>;

    //
    // Builds a reader that asks the thread at the other end of `port`.
    //
    constructor(port: IReaderPort) {
        this.port = port;
        this.pending = new Map();
        this.sent = 0;
        this.measured = new Map();
        port.on("message", (message: unknown) => {
            this.settle(message);
        });
        port.on("error", (error: unknown) => {
            this.failAll(error);
        });
        assert.equal(this.pending.size, 0);
    }

    //
    // Hands a reply to the request it answers. A reply to no request waiting is a defect in
    // Faultline.
    //
    settle(message: unknown): void {
        assert(isReaderReply(message), "The reader thread sent a message that is not a reply.");
        const waiting = this.pending.get(message.id);
        assert(waiting !== undefined, `The reader thread answered request ${message.id}, which is not waiting.`);
        this.pending.delete(message.id);
        waiting.resolve(message);
    }

    //
    // Fails every request waiting, because the thread that would answer them has ended.
    //
    failAll(error: unknown): void {
        const reason = error instanceof Error ? error : new Error(String(error));
        const waiting = [...this.pending.values()];
        this.pending.clear();
        for (const request of waiting) {
            request.reject(new Error(`The reader thread failed, which is a defect in Faultline: ${reason.message}`));
        }
        assert.equal(this.pending.size, 0);
    }

    //
    // Sends a request and waits for its reply. The thread gives an error only when Faultline's own
    // code failed, so a reply with one fails the call that asked as a defect.
    //
    async ask(request: IReaderRequest): Promise<IReaderReply> {
        assert(!this.pending.has(request.id));
        const reply = await new Promise<IReaderReply>((resolve, reject) => {
            this.pending.set(request.id, {
                resolve,
                reject,
            });
            this.port.postMessage(request);
        });
        assert.equal(reply.id, request.id);
        assert.equal(reply.error, "", `The reader thread could not do request ${request.id}, which is a defect in Faultline: ${reply.error}`);
        return reply;
    }

    //
    // Reads a shard on the thread.
    //
    async read(file: string, sims: string[]): Promise<IShardReading> {
        assert(file.length > 0);
        assert(Array.isArray(sims));
        this.sent += 1;
        const reply = await this.ask({
            id: this.sent,
            kind: "read",
            file,
            sims,
            url: "",
        });
        assert(reply.reading !== undefined, `The reader thread read ${file} and sent nothing back.`);
        return reply.reading;
    }

    //
    // Measures a file on the thread, once per URL. A URL that is not a file's names no source file
    // of the project, so the thread is not asked about it.
    //
    async measure(url: string): Promise<MeasuredFile | undefined> {
        assert(url.length > 0);
        assert(!url.includes("?"), `${url} was measured with its query, so every copy of it would be measured again.`);
        if (!url.startsWith("file:")) {
            return undefined;
        }
        if (this.measured.has(url)) {
            return this.measured.get(url);
        }
        this.sent += 1;
        const reply = await this.ask({
            id: this.sent,
            kind: "measure",
            file: "",
            sims: [],
            url,
        });
        assert.equal(reply.reading, undefined);
        this.measured.set(url, reply.measured);
        return reply.measured;
    }
}
