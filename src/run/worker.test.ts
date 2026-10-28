//
// Checks the worker against fake children: calls answered with what the child sent back, a call
// that never answers killed and reported as never returning, a child that ends part way through a
// call reported as a crash with what it wrote, a new child opened on the same shard after each of
// those and after the settings' number of calls, one child serving shard after shard, a shard the
// child cannot open described by its top level and a late reply or end from a child the worker gave up on left unanswered. The
// sentences and results the worker makes up itself are checked too, and `WorkerFactory` against a
// mocked `fork`.
//
// A fake child is an event emitter that answers each request from a script, made by a fake
// `IWorkerFactory`, so no process is started and no file is written. The worker's limits run on
// Jest's fake timers, moved on by the test, so a call that never answers is judged without any
// real waiting.
//

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { ICalledReply, ICallRequest, ICallResult, IOpenedReply, IOpenRequest, IReadReply, IReply, IRequest, IShardFacts } from "./messages.ts";
import { afterSettleMs, callsPerChildMost, callsPerReadingMost, callWallMs, createWorker, defaultWorkerSettings, deliverAnswer, endedBecause, failedCall, failedOpenCall, isCalledReply, killAfterMs, killChild, openLimitMs, startChild, stopChild, WorkerFactory, type IChildProcess, type IWorkerFactory, type IWorkerSettings, type IWorkerState } from "./worker.ts";

//
// `fork` hands back a stand-in for the child, with the error stream the worker requires, so no
// process is started.
//
jest.mock("node:child_process", () => ({
    fork: jest.fn(() => ({
        stderr: "the forked child's error stream",
    })),
}));

//
// The worker's timers are fake and moved on by `settle`. The fake children answer on the next turn
// of the event loop through `setImmediate`, which stays real so their answers arrive.
//
beforeEach(() => {
    jest.useFakeTimers({
        doNotFake: ["setImmediate"],
    });
});

afterEach(() => {
    jest.useRealTimers();
});

//
// Waits for `pending`, giving the event loop a turn and then moving the fake clock on a millisecond
// each time round, so a limit the worker set passes as soon as nothing else can settle it. The
// bound on rounds is far past any limit the tests set.
//
export async function settle<Value>(pending: Promise<Value>): Promise<Value> {
    let isDone = false;
    const watched = pending.finally(() => {
        isDone = true;
    });
    for (let round = 0; round < 1000; round += 1) {
        if (isDone) {
            break;
        }
        await new Promise((resolve) => {
            setImmediate(resolve);
        });
        if (!isDone) {
            await jest.advanceTimersByTimeAsync(1);
        }
    }
    assert(isDone, "The worker did not settle within the rounds the test allows.");
    return watched;
}

//
// The child `started` holds at `index`, which the test expects the worker to have started.
//
export function childAt(started: FakeChild[], index: number): FakeChild {
    const child = started[index];
    assert(child !== undefined, `The worker started no child at ${index}.`);
    return child;
}

//
// A fake child's error stream: an emitter that remembers the encoding it was set to.
//
export class FakeErrorStream extends EventEmitter {
    //
    // The encoding the worker asked for.
    //
    encoding = "";

    //
    // Remembers the encoding.
    //
    setEncoding(encoding: BufferEncoding): this {
        this.encoding = encoding;
        return this;
    }
}

//
// A child process that answers each request from `script`, writing down every request it is sent.
//
export class FakeChild extends EventEmitter implements IChildProcess {
    //
    // The code it exited with, once it has.
    //
    exitCode: number | null = null;

    //
    // The signal that ended it, once one has.
    //
    signalCode: NodeJS.Signals | null = null;

    //
    // Its error stream.
    //
    stderr = new FakeErrorStream();

    //
    // Every request it was sent, in order.
    //
    requests: IRequest[] = [];

    //
    // The tokens of the calls it answered since its last coverage reading.
    //
    unread: string[] = [];

    //
    // Writes the request down and answers it from the script.
    //
    send(message: IRequest): boolean {
        this.requests.push(message);
        script(message, this);
        return true;
    }

    //
    // Ends the child with `signal` on the next turn, as a real kill does.
    //
    kill(signal: NodeJS.Signals): boolean {
        setImmediate(() => {
            this.end(null, signal);
        });
        return true;
    }

    //
    // Sends `message` back on the next turn, as a real child's reply arrives.
    //
    reply(message: IReply): void {
        setImmediate(() => {
            this.emit("message", message);
        });
    }

    //
    // Ends the child at once with `code` or `signal`, unless it has already ended.
    //
    end(code: number | null, signal: NodeJS.Signals | null): void {
        if (this.isEnded()) {
            return;
        }
        this.exitCode = code;
        this.signalCode = signal;
        this.emit("exit", code, signal);
    }

    //
    // Whether the child has ended.
    //
    isEnded(): boolean {
        if (this.exitCode !== null) {
            return true;
        }
        return this.signalCode !== null;
    }
}

//
// A fake child that ends with exit code 3 on the next turn after any request, whatever the script
// says, so a child started again can fail to open a shard the first child opened.
//
export class EndingChild extends FakeChild {
    //
    // Writes the request down and ends the child.
    //
    send(message: IRequest): boolean {
        this.requests.push(message);
        setImmediate(() => {
            this.end(3, null);
        });
        return true;
    }
}

//
// A fake child that opens shards as the script says and ends with exit code 4 on the next turn
// after any other request, so calls made again in a new child can go unanswered.
//
export class EndingOnCallChild extends FakeChild {
    //
    // Answers an open from the script and ends the child on anything else.
    //
    send(message: IRequest): boolean {
        if (isOpenRequest(message)) {
            return super.send(message);
        }
        this.requests.push(message);
        setImmediate(() => {
            this.end(4, null);
        });
        return true;
    }
}

//
// A factory whose first child follows the script and whose later children are made by `later`,
// keeping each in `started`.
//
export function factoryThen(started: FakeChild[], later: () => FakeChild): IWorkerFactory {
    return {
        create(): IChildProcess {
            const child = started.length === 0 ? new FakeChild() : later();
            started.push(child);
            return child;
        },
    };
}

//
// Settings that take a coverage reading every `callsPerReading` calls, and otherwise those of
// `settingsWith`.
//
export function readingEvery(callsPerReading: number, callsPerChild: number): IWorkerSettings {
    return {
        ...settingsWith(1000, callsPerChild),
        callsPerReading,
    };
}

//
// The facts of `file`: one function `f`.
//
export function factsOf(file: string): IShardFacts {
    return {
        file,
        functions: [{
            label: "f",
            name: "f",
            line: 1,
            uncallable: undefined,
            unbuildable: undefined,
            choices: [],
            targets: [],
        }],
        scenarios: [],
        paths: [],
        notProvable: [],
        uncallable: [],
        simProblems: [],
        loadProblem: undefined,
    };
}

//
// The result of the call `token`, exercising one path.
//
export function resultOf(token: string): ICallResult {
    return {
        token,
        exercised: ["src/a.ts\tf:entered"],
        reached: [],
        injected: false,
        failures: [],
        arguments: [],
    };
}

//
// Whether a request asks the child to open a shard. `messages.ts` offers no guard for requests,
// and the fake child needs one to read the file without a cast.
//
export function isOpenRequest(request: IRequest): request is IOpenRequest {
    return request.kind === "open";
}

//
// Whether a request asks the child to make a call, so the fake child can read its token without a
// cast.
//
export function isCallRequest(request: IRequest): request is ICallRequest {
    return request.kind === "call";
}

//
// The script every fake child follows. Opening `src/ends.ts` ends the child and opening
// `src/slow.ts` or `src/slow.sim.ts` never answers; any other open answers with the file's facts.
// A call to `hang` never answers, a call to `end` writes on the error stream and exits with code 1
// and any other call answers with its result.
//
export function script(request: IRequest, child: FakeChild): void {
    if (isOpenRequest(request)) {
        const file = request.file;
        if (file === "src/ends.ts") {
            setImmediate(() => {
                child.end(null, "SIGKILL");
            });
            return;
        }
        if (file.startsWith("src/slow.")) {
            return;
        }
        const opened: IOpenedReply = {
            kind: "opened",
            shard: factsOf(file),
        };
        child.reply(opened);
        return;
    }
    if (request.kind === "read") {
        if (child.unread.some((token) => token.includes(":endsreading;"))) {
            setImmediate(() => {
                child.end(2, null);
            });
            return;
        }
        const read: IReadReply = {
            kind: "read",
            exercised: child.unread.splice(0, child.unread.length).map((token) => `${token}\tread`),
        };
        child.reply(read);
        return;
    }
    assert(isCallRequest(request));
    const token = request.token;
    if (token.includes(":hang;")) {
        return;
    }
    if (token.includes(":end;")) {
        setImmediate(() => {
            child.stderr.emit("data", "it broke\n");
            child.end(1, null);
        });
        return;
    }
    const result = resultOf(token);
    if (!request.read) {
        child.unread.push(token);
        result.exercised = [];
    }
    else {
        if (child.unread.length > 0) {
            result.exercised = [...child.unread.splice(0, child.unread.length).map((one) => `${one}\tread`), ...result.exercised];
        }
    }
    const called: ICalledReply = {
        kind: "called",
        result,
    };
    child.reply(called);
}

//
// Settings with limits of a few milliseconds, which a fake child that does not answer waits out at
// once. `openLimitMs` is given, so a test can make opening fail.
//
export function settingsWith(openLimitMs: number, callsPerChild: number): IWorkerSettings {
    return {
        nodePath: "/node",
        childEntry: "/tool/run/child-main.ts",
        child: {
            projectRoot: "/project",
            toolModules: "/tool",
            simTypes: [],
            limits: {
                wallMs: 1,
                afterSettleMs: 1,
            },
        },
        killAfterMs: 5,
        openLimitMs,
        callsPerChild,
        callsPerReading: 1,
    };
}

//
// A factory that makes fake children, keeping each in `started`.
//
export function factoryOf(started: FakeChild[]): IWorkerFactory {
    return {
        create(): IChildProcess {
            const child = new FakeChild();
            started.push(child);
            return child;
        },
    };
}

//
// A request to open `file`.
//
export function openOf(file: string): IOpenRequest {
    return {
        kind: "open",
        file,
        sims: [],
        seed: 5,
    };
}

describe("a worker over fake children", () => {
    test("a shard opens in a child reading its error stream as text, and calls are answered with what the child sent", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(1000, 1000), factoryOf(started));
        assert.deepEqual(await worker.open(openOf("src/a.ts")), factsOf("src/a.ts"));
        assert.deepEqual(await worker.call("src/a.ts:f;seed=5"), resultOf("src/a.ts:f;seed=5"));
        assert.equal(started.length, 1);
        assert.equal(childAt(started, 0).stderr.encoding, "utf8");
        assert.deepEqual(childAt(started, 0).requests.map((request) => request.kind), ["open", "call"]);
        await worker.stop();
        assert.equal(childAt(started, 0).signalCode, "SIGKILL");
    });

    test("a call that never answers is killed and reported, and the next call opens the shard in a new child", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(1000, 1000), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        const hung = await settle(worker.call("src/a.ts:hang;seed=5"));
        assert.deepEqual(hung.failures.map((one) => [one.kind, one.message]), [["hang", "The call to hang never returned."]]);
        assert.deepEqual(await worker.call("src/a.ts:f;seed=5"), resultOf("src/a.ts:f;seed=5"));
        assert.equal(started.length, 2);
        assert.deepEqual(childAt(started, 1).requests.map((request) => request.kind), ["open", "call"]);
        await worker.stop();
    });

    test("a child that ends part way through a call is a crash with what it wrote, and the next call works", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(1000, 1000), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        const ended = await worker.call("src/a.ts:end;seed=5");
        assert.deepEqual(ended.failures.map((one) => [one.kind, one.message]), [["crash", "The call to end ended the process running it with exit code 1, saying: it broke."]]);
        assert.deepEqual(await worker.call("src/a.ts:f;seed=5"), resultOf("src/a.ts:f;seed=5"));
        assert.equal(started.length, 2);
        await worker.stop();
    });

    test("a child that ends between requests is started again for the next call", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(1000, 1000), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        childAt(started, 0).end(0, null);
        assert.deepEqual(await worker.call("src/a.ts:f;seed=5"), resultOf("src/a.ts:f;seed=5"));
        assert.equal(started.length, 2);
        await worker.stop();
    });

    test("a child started again that ends while opening the shard reports the call as a crash", async () => {
        const started: FakeChild[] = [];
        const factory: IWorkerFactory = {
            create(): IChildProcess {
                const child = started.length === 0 ? new FakeChild() : new EndingChild();
                started.push(child);
                return child;
            },
        };
        const worker = createWorker(settingsWith(1000, 1000), factory);
        await worker.open(openOf("src/a.ts"));
        childAt(started, 0).end(0, null);
        const call = await worker.call("src/a.ts:f;seed=5");
        assert.deepEqual(call.failures.map((one) => [one.kind, one.message]), [["crash", "The call to f ended the process running it with exit code 3."]]);
        assert.equal(started.length, 2);
        await worker.stop();
    });

    test("calls leave their coverage for every few calls' reading, and a reading of nothing asks the child nothing", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(readingEvery(3, 1000), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        assert.deepEqual((await worker.call("src/a.ts:f;seed=1")).exercised, []);
        assert.deepEqual((await worker.call("src/a.ts:f;seed=2")).exercised, []);
        assert.deepEqual((await worker.call("src/a.ts:f;seed=3")).exercised, ["src/a.ts:f;seed=1\tread", "src/a.ts:f;seed=2\tread", "src/a.ts\tf:entered"]);
        assert.deepEqual(await worker.read(), []);
        await worker.call("src/a.ts:f;seed=4");
        assert.deepEqual(await worker.read(), ["src/a.ts:f;seed=4\tread"]);
        assert.deepEqual(childAt(started, 0).requests.map((request) => request.kind), ["open", "call", "call", "call", "call", "read"]);
        await worker.stop();
    });

    test("calls left unread by a child that ended are made again in a new child and read there", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(readingEvery(3, 1000), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        await worker.call("src/a.ts:f;seed=1");
        const ended = await worker.call("src/a.ts:end;seed=1");
        assert.deepEqual(ended.failures.map((one) => one.kind), ["crash"]);
        assert.deepEqual(ended.exercised, ["src/a.ts\tf:entered"]);
        assert.equal(started.length, 2);
        assert.deepEqual(childAt(started, 1).requests.map((request) => request.kind), ["open", "call"]);
        await worker.stop();
    });

    test("a child that ends while reading has its calls made again in a new child", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(readingEvery(3, 1000), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        await worker.call("src/a.ts:endsreading;seed=1");
        assert.deepEqual(await worker.read(), ["src/a.ts\tf:entered"]);
        assert.equal(started.length, 2);
        await worker.stop();
    });

    test("calls left unread are given up when the new child cannot open the shard or answer them", async () => {
        for (const later of [() => new EndingChild(), () => new EndingOnCallChild()]) {
            const started: FakeChild[] = [];
            const worker = createWorker(readingEvery(3, 1000), factoryThen(started, later));
            await worker.open(openOf("src/a.ts"));
            await worker.call("src/a.ts:f;seed=1");
            const ended = await worker.call("src/a.ts:end;seed=1");
            assert.deepEqual(ended.exercised, []);
            assert.equal(started.length, 2);
            await worker.stop();
        }
    });

    test("a child started again after its number of calls first reads what its calls left unread", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(readingEvery(5, 2), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        await worker.call("src/a.ts:f;seed=1");
        const second = await worker.call("src/a.ts:f;seed=2");
        assert.deepEqual(second.exercised, ["src/a.ts:f;seed=1\tread", "src/a.ts:f;seed=2\tread"]);
        assert.equal(childAt(started, 0).signalCode, "SIGKILL");
        await worker.stop();
    });

    test("one child opens shard after shard, because every call loads copies of its own", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(1000, 1000), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        await worker.call("src/a.ts:f;seed=5");
        await worker.open(openOf("src/b.ts"));
        assert.deepEqual(await worker.call("src/b.ts:f;seed=5"), resultOf("src/b.ts:f;seed=5"));
        assert.equal(started.length, 1);
        assert.equal(childAt(started, 0).isEnded(), false);
        assert.deepEqual(childAt(started, 0).requests.map((request) => request.kind), ["open", "call", "open", "call"]);
        await worker.stop();
    });

    test("a child that has made the settings' number of calls is stopped, and the next call opens the shard in a new child", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(1000, 2), factoryOf(started));
        await worker.open(openOf("src/a.ts"));
        await worker.call("src/a.ts:f;seed=5");
        assert.equal(childAt(started, 0).isEnded(), false);
        await worker.call("src/a.ts:f;seed=5");
        assert.equal(childAt(started, 0).isEnded(), true);
        assert.deepEqual(await worker.call("src/a.ts:f;seed=5"), resultOf("src/a.ts:f;seed=5"));
        assert.equal(started.length, 2);
        assert.deepEqual(childAt(started, 1).requests.map((request) => request.kind), ["open", "call"]);
        await worker.stop();
    });

    test("a child that ends while opening leaves only the top level, and calling it reports the failed open without opening again", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(1000, 1000), factoryOf(started));
        const facts = await worker.open(openOf("src/ends.ts"));
        assert.equal(facts.loadProblem, "The child process opening src/ends.ts ended with the signal SIGKILL.");
        assert.deepEqual(facts.functions.map((one) => [one.name, one.targets]), [["(top level)", ["src/ends.ts\t(top level):entered"]]]);
        const call = await worker.call("src/ends.ts:(top level);seed=5");
        assert.deepEqual(call.failures.map((one) => [one.kind, one.message, one.key]), [["crash", "The call to (top level) was not made, because the child process opening src/ends.ts ended with the signal SIGKILL.", "open|src/ends.ts"]]);
        assert.equal(started.length, 1);
        await worker.stop();
    });

    test("a shard opened after one that failed to open is opened and called as usual", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(1000, 1000), factoryOf(started));
        await worker.open(openOf("src/ends.ts"));
        await worker.open(openOf("src/a.ts"));
        assert.deepEqual(await worker.call("src/a.ts:f;seed=5"), resultOf("src/a.ts:f;seed=5"));
        assert.equal(started.length, 2);
        await worker.stop();
    });

    test("a shard that cannot be opened in time is described by its top level, and a sim file by nothing", async () => {
        const started: FakeChild[] = [];
        const worker = createWorker(settingsWith(5, 1000), factoryOf(started));
        const facts = await settle(worker.open(openOf("src/slow.ts")));
        assert.equal(facts.loadProblem, "The child process opening src/slow.ts did not finish within 5 milliseconds.");
        assert.equal(facts.functions.length, 1);
        const top = await settle(worker.call("src/slow.ts:(top level);seed=5"));
        assert.deepEqual(top.failures.map((one) => [one.kind, one.message]), [["hang", "The call to (top level) never returned."]]);
        assert.equal(started.length, 1);
        const sim = await settle(worker.open(openOf("src/slow.sim.ts")));
        assert.deepEqual(sim.functions, []);
        const call = await settle(worker.call("src/slow.sim.ts:anything;seed=5"));
        assert.deepEqual(call.failures.map((one) => one.message), ["The scenario anything never returned."]);
        await worker.stop();
    });

    test("a call before any shard is opened is a defect in the caller", async () => {
        const worker = createWorker(settingsWith(1000, 1000), factoryOf([]));
        await assert.rejects(worker.call("src/a.ts:f;seed=5"), /A call was made before any shard was opened\./);
    });
});

//
// A worker's state with no child started.
//
export function workerState(started: FakeChild[]): IWorkerState {
    return {
        settings: settingsWith(1000, 1000),
        factory: factoryOf(started),
        child: undefined,
        errors: "",
        shard: undefined,
        isOpen: false,
        calls: 0,
        unread: [],
        failedOpen: undefined,
        pending: undefined,
    };
}

describe("the parts", () => {
    test("an error on the channel to the child is kept with what the child wrote", () => {
        const started: FakeChild[] = [];
        const state = workerState(started);
        assert.equal(startChild(state), started[0]);
        childAt(started, 0).stderr.emit("data", "said\n");
        childAt(started, 0).emit("error", new Error("The channel closed."));
        assert.equal(state.errors, "said\nThe channel closed.\n");
    });

    test("an old child ending or replying late does not touch the child that replaced it", () => {
        const started: FakeChild[] = [];
        const state = workerState(started);
        startChild(state);
        killChild(state);
        const second = startChild(state);
        const late: IOpenedReply = {
            kind: "opened",
            shard: factsOf("src/a.ts"),
        };
        childAt(started, 0).emit("message", late);
        childAt(started, 0).end(0, null);
        assert.equal(state.child, second);
        assert.equal(state.pending, undefined);
    });

    test("killing or stopping a worker with no child, or whose child already exited or was signalled, does nothing", async () => {
        const started: FakeChild[] = [];
        const state = workerState(started);
        killChild(state);
        await stopChild(state);
        startChild(state);
        childAt(started, 0).end(0, null);
        state.child = childAt(started, 0);
        state.isOpen = true;
        await stopChild(state);
        assert.equal(state.child, undefined);
        assert.equal(state.isOpen, false);
        startChild(state);
        childAt(started, 1).end(null, "SIGTERM");
        state.child = childAt(started, 1);
        await stopChild(state);
        assert.equal(state.child, undefined);
        assert.equal(childAt(started, 1).signalCode, "SIGTERM");
    });

    test("an answer with no request waiting, or a child's end with neither a code nor a signal, is a defect", () => {
        const state = workerState([]);
        assert.throws(() => {
            deliverAnswer(state, {
                reply: undefined,
                ended: undefined,
            });
        }, /The child answered when no request was waiting\./);
        assert.throws(() => {
            endedBecause(null, null, "");
        }, assert.AssertionError);
    });

    test("a reply is a call's answer only when it says it is", () => {
        const called: ICalledReply = {
            kind: "called",
            result: resultOf("src/a.ts:f;seed=5"),
        };
        const opened: IOpenedReply = {
            kind: "opened",
            shard: factsOf("src/a.ts"),
        };
        assert.equal(isCalledReply(called), true);
        assert.equal(isCalledReply(opened), false);
    });

    test("a run's workers start with the limits Faultline sets and the sim types where its own modules declare them", () => {
        const settings = defaultWorkerSettings("/project", "/tool/dist", "/tool/dist/run/child-main.js");
        assert.equal(settings.nodePath, process.execPath);
        assert.equal(settings.childEntry, "/tool/dist/run/child-main.js");
        assert.deepEqual(settings.child.simTypes, ["/tool/dist/sim/index.ts", "/tool/dist/sim/index.d.ts"]);
        assert.deepEqual(settings.child.limits, {
            wallMs: callWallMs,
            afterSettleMs,
        });
        assert.equal(settings.killAfterMs, killAfterMs);
        assert.ok(settings.killAfterMs > settings.child.limits.wallMs);
        assert.equal(settings.openLimitMs, openLimitMs);
        assert.equal(settings.callsPerChild, callsPerChildMost);
        assert.equal(settings.callsPerReading, callsPerReadingMost);
    });

    test("the real child is forked from the child's entry under the settings' Node, with its settings and a JSON channel", () => {
        const settings = settingsWith(1000, 1000);
        const created = new WorkerFactory().create(settings);
        assert.equal(created.stderr, "the forked child's error stream");
        expect(fork).toHaveReturnedWith(created);
        expect(fork).toHaveBeenCalledWith("/tool/run/child-main.ts", [JSON.stringify(settings.child)], {
            execPath: "/node",
            execArgv: [],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            serialization: "json",
        });
    });

    test("how a child ended is written as the end of a sentence, with what it said", () => {
        assert.equal(endedBecause(1, null, "  it broke\n"), "with exit code 1, saying: it broke");
        assert.equal(endedBecause(null, "SIGKILL", ""), "with the signal SIGKILL");
    });

    test("a call with no answer is a hang when the child was killed and a crash when it ended", () => {
        const hang = failedCall("src/a.ts:f;seed=1", undefined);
        assert.deepEqual(hang.failures.map((one) => [one.kind, one.key]), [["hang", "hang|src/a.ts|f"]]);
        assert.deepEqual(hang.exercised, []);
        const crash = failedCall("src/a.sim.ts:s;seed=1", "with exit code 2");
        assert.deepEqual(crash.failures.map((one) => [one.kind, one.message]), [["crash", "The scenario s ended the process running it with exit code 2."]]);
    });

    test("a call of a shard that failed to open is a hang when the open ran out of time and a failed open when the child ended", () => {
        const hang = failedOpenCall("src/a.ts:(top level);seed=1", undefined);
        assert.deepEqual(hang.failures.map((one) => [one.kind, one.key]), [["hang", "hang|src/a.ts|(top level)"]]);
        const ended = failedOpenCall("src/a.ts:(top level);seed=1", "with exit code 2");
        assert.deepEqual(ended.failures.map((one) => [one.kind, one.key, one.message]), [["crash", "open|src/a.ts", "The call to (top level) was not made, because the child process opening src/a.ts ended with exit code 2."]]);
        assert.deepEqual(ended.exercised, []);
    });
});
