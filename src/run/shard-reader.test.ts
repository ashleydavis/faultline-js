//
// Checks the shard reader: the local reader reads a shard and measures a file of a project held in
// memory; a request is answered with the reader's result or with the error it failed with; and the
// thread reader sends each request to a fake port, hands each reply to the call that asked, keeps
// what it measured, fails with the error a reply carries and fails every waiting call when the
// thread ends.
//

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "@jest/globals";
import type { MeasuredFile } from "../coverage/v8.ts";
import { createFakeProject, projectRoot, simTypesFile } from "../lib/fake-files.test.ts";
import { createLoader } from "../load/hooks.ts";
import { answerReaderRequest, isReaderReply, LocalShardReader, ThreadShardReader, type IReaderReply, type IReaderRequest, type IShardReader } from "./shard-reader.ts";
import type { IShardReading } from "./shard.ts";

//
// A reader over a project in memory with one source file and the sim file beside it.
//
export function createLocalReader(): LocalShardReader {
    const files = createFakeProject({
        "src/pick.ts": "export function pick(value: number): string {\n    if (value > 2) {\n        return \"big\";\n    }\n    return \"small\";\n}\n",
        "src/pick.sim.ts": "import type { ScenarioContext } from \"faultline\";\nexport function picks(context: ScenarioContext): void {\n    context.expect(true, \"fine\");\n}\n",
    });
    const loader = createLoader({
        projectRoot,
        toolModules: path.resolve(__dirname, ".."),
    }, files);
    return new LocalShardReader(loader, [simTypesFile]);
}

//
// A request with every field filled the way the thread reader fills it.
//
export function readerRequest(fields: { id: number; kind: "read" | "measure"; file: string; url: string }): IReaderRequest {
    return {
        id: fields.id,
        kind: fields.kind,
        file: fields.file,
        sims: fields.kind === "read" ? ["src/pick.sim.ts"] : [],
        url: fields.url,
    };
}

//
// A reader that fails every request, with an error or with a value that is not one.
//
export class FailingReader implements IShardReader {
    //
    // What each request fails with.
    //
    private thrown: unknown;

    //
    // Builds a reader that fails with `thrown`.
    //
    constructor(thrown: unknown) {
        this.thrown = thrown;
    }

    //
    // Fails.
    //
    read(): Promise<IShardReading> {
        return Promise.reject(this.thrown);
    }

    //
    // Fails.
    //
    measure(): Promise<MeasuredFile | undefined> {
        return Promise.reject(this.thrown);
    }
}

//
// A port standing in for the reader's thread: it keeps every request sent and lets the test answer.
//
export class FakePort extends EventEmitter {
    //
    // Every request sent, in order.
    //
    readonly sent: IReaderRequest[] = [];

    //
    // Keeps a request.
    //
    postMessage(request: IReaderRequest): void {
        this.sent.push(request);
    }
}

//
// A reply to request `id` with `fields` in it and every other field empty.
//
export function readerReply(id: number, fields: { reading: IShardReading | undefined; measured: MeasuredFile | undefined; error: string }): IReaderReply {
    return {
        id,
        reading: fields.reading,
        measured: fields.measured,
        error: fields.error,
    };
}

//
// What a measured file is in these tests: no path at all.
//
export function measuredFile(url: string): MeasuredFile {
    return {
        url,
        paths: [],
        notProvable: [],
    };
}

//
// Lets the promises waiting on a reply run, so the request they send reaches the port.
//
export function turn(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

describe("LocalShardReader", () => {
    test("a shard is read with its sim file and a file is measured once, from the text loaded for it", async () => {
        const reader = createLocalReader();
        const reading = await reader.read("src/pick.ts", ["src/pick.sim.ts"]);
        assert.deepEqual(reading.facts?.functions.map((found) => found.label), ["(top level)", "pick"]);
        assert.deepEqual(reading.sims[0]?.scenarios.map((scenario) => scenario.exportName), ["picks"]);
        const url = pathToFileURL(path.join(projectRoot, "src", "pick.ts")).href;
        const measured = await reader.measure(url);
        assert.deepEqual(measured?.paths.map((found) => found.path.name), ["(top level):entered", "pick:entered", "if:2:true", "if:2:false"]);
        assert.equal(await reader.measure(url), measured);
        assert.equal(await reader.measure("node:fs"), undefined);
    });

    test("a URL measured with its query is a defect in Faultline", () => {
        const reader = createLocalReader();
        const url = pathToFileURL(path.join(projectRoot, "src", "pick.ts")).href;
        assert.throws(() => reader.measure(`${url}?flt=1`), /was measured with its query/);
        assert.throws(() => reader.measure(""), assert.AssertionError);
    });
});

describe("answerReaderRequest", () => {
    test("a read and a measure are answered with what the reader found, under the request's number", async () => {
        const reader = createLocalReader();
        const read = await answerReaderRequest(reader, readerRequest({
            id: 3,
            kind: "read",
            file: "src/pick.ts",
            url: "",
        }));
        assert.equal(read.id, 3);
        assert.equal(read.error, "");
        assert.equal(read.measured, undefined);
        assert.deepEqual(read.reading?.facts?.functions.map((found) => found.label), ["(top level)", "pick"]);
        const measured = await answerReaderRequest(reader, readerRequest({
            id: 4,
            kind: "measure",
            file: "",
            url: pathToFileURL(path.join(projectRoot, "src", "pick.ts")).href,
        }));
        assert.equal(measured.id, 4);
        assert.equal(measured.reading, undefined);
        assert.equal(measured.measured?.paths.length, 4);
    });

    test("a failure is put in the reply with its stack, or as text when what was thrown is not an error", async () => {
        const failed = await answerReaderRequest(new FailingReader(new Error("no compiler")), readerRequest({
            id: 1,
            kind: "read",
            file: "src/pick.ts",
            url: "",
        }));
        assert.match(failed.error, /^Error: no compiler\n/);
        assert.equal(failed.reading, undefined);
        const odd = await answerReaderRequest(new FailingReader("odd"), readerRequest({
            id: 2,
            kind: "measure",
            file: "",
            url: "file:///project/src/pick.ts",
        }));
        assert.equal(odd.error, "odd");
        const bare = new Error("no stack");
        bare.stack = undefined;
        const unstacked = await answerReaderRequest(new FailingReader(bare), readerRequest({
            id: 3,
            kind: "read",
            file: "src/pick.ts",
            url: "",
        }));
        assert.equal(unstacked.error, "no stack");
    });
});

describe("isReaderReply", () => {
    test("only an object with a numbered id and an error is a reply", () => {
        assert(isReaderReply(readerReply(1, {
            reading: undefined,
            measured: undefined,
            error: "",
        })));
        assert(!isReaderReply(undefined));
        assert(!isReaderReply(null));
        assert(!isReaderReply("reply"));
        assert(!isReaderReply({
            error: "",
        }));
        assert(!isReaderReply({
            id: 1,
        }));
        assert(!isReaderReply({
            id: "1",
            error: "",
        }));
    });
});

describe("ThreadShardReader", () => {
    test("each request goes to the thread numbered, and each reply reaches the call that asked", async () => {
        const port = new FakePort();
        const reader = new ThreadShardReader(port);
        const reading: IShardReading = {
            facts: undefined,
            sims: [],
            conditions: new Map(),
            parseErrors: [],
        };
        const asked = reader.read("src/pick.sim.ts", ["src/pick.sim.ts"]);
        await turn();
        assert.deepEqual(port.sent, [{
            id: 1,
            kind: "read",
            file: "src/pick.sim.ts",
            sims: ["src/pick.sim.ts"],
            url: "",
        }]);
        port.emit("message", readerReply(1, {
            reading,
            measured: undefined,
            error: "",
        }));
        assert.equal(await asked, reading);
    });

    test("a file is measured on the thread once, and a URL that is not a file's is never sent", async () => {
        const port = new FakePort();
        const reader = new ThreadShardReader(port);
        const url = "file:///project/src/pick.ts";
        const first = reader.measure(url);
        await turn();
        assert.equal(port.sent.length, 1);
        assert.equal(port.sent[0]?.kind, "measure");
        port.emit("message", readerReply(1, {
            reading: undefined,
            measured: measuredFile(url),
            error: "",
        }));
        const measured = await first;
        assert.equal(measured?.url, url);
        assert.equal(await reader.measure(url), measured);
        assert.equal(await reader.measure("node:internal/fs"), undefined);
        const missing = reader.measure("file:///project/node_modules/x.js");
        await turn();
        port.emit("message", readerReply(2, {
            reading: undefined,
            measured: undefined,
            error: "",
        }));
        assert.equal(await missing, undefined);
        assert.equal(await reader.measure("file:///project/node_modules/x.js"), undefined);
        assert.equal(port.sent.length, 2);
    });

    test("a reply that carries an error fails the call with it", async () => {
        const port = new FakePort();
        const reader = new ThreadShardReader(port);
        const asked = reader.read("src/pick.ts", []);
        await turn();
        port.emit("message", readerReply(1, {
            reading: undefined,
            measured: undefined,
            error: "Error: no compiler",
        }));
        await assert.rejects(asked, /The reader thread could not do request 1, which is a defect in Faultline: Error: no compiler/);
    });

    test("a URL measured with its query, or a read of no file, is a defect in Faultline and never sent", async () => {
        const port = new FakePort();
        const reader = new ThreadShardReader(port);
        await assert.rejects(reader.measure("file:///project/src/pick.ts?flt=1"), /was measured with its query/);
        await assert.rejects(reader.read("", []), assert.AssertionError);
        assert.deepEqual(port.sent, []);
    });

    test("a thread that ends fails every call waiting on it", async () => {
        const port = new FakePort();
        const reader = new ThreadShardReader(port);
        const read = reader.read("src/pick.ts", []);
        const measured = reader.measure("file:///project/src/pick.ts");
        await turn();
        port.emit("error", new Error("out of memory"));
        await assert.rejects(read, /The reader thread failed, which is a defect in Faultline: out of memory/);
        await assert.rejects(measured, /out of memory/);
        port.emit("error", "ended again");
    });

    test("a message that is not a reply, or answers no request waiting, is a defect in Faultline", () => {
        const port = new FakePort();
        const reader = new ThreadShardReader(port);
        assert.throws(() => reader.settle("hello"), /is not a reply/);
        assert.throws(() => reader.settle(readerReply(9, {
            reading: undefined,
            measured: undefined,
            error: "",
        })), /answered request 9, which is not waiting/);
    });
});
