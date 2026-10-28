//
// One worker: a child process with the module hooks loaded, which the worker sends the shards to
// open and then one call at a time as a replay token.
//
// Every call gets copies of the project's modules of its own, so a call goes the same way whatever
// the child did before it, and one child serves shard after shard. The child is started again
// whenever it cannot be trusted to carry on: after a call that never answered (the child is
// killed), after the child ended part way through a call and after a fixed number of calls, so the
// copies of modules left behind do not grow without bound. A call that called `process.exit` keeps
// the child, because the simulated `process.exit` stops the call inside the child and the process
// itself never exits. A new child opens the shard the worker is on before it is sent the next
// call, so the calls carry on where they were.
//

import assert from "node:assert/strict";
import { fork } from "node:child_process";
import path from "node:path";
import { topLevelLabel } from "../discover/functions.ts";
import { isSimFile } from "../discover/sources.ts";
import { emptyFacts } from "./child.ts";
import type { IShardExecutor } from "./explore.ts";
import { judgeFailedOpen, judgeHang, subjectOf, type IFailure } from "./judge.ts";
import { pathKey } from "./measure.ts";
import { isOpenedReply, isReadReply, type ICalledReply, type ICallRequest, type ICallResult, type IChildSettings, type IOpenRequest, type IReadRequest, type IReply, type IRequest, type IShardFacts } from "./messages.ts";
import { readToken } from "./token.ts";

//
// The most of what a child wrote on its error stream that the worker keeps, in characters. The end
// of it says why the child ended, and the rest would only make the report longer.
//
const keptErrorLength = 4000;

//
// How long a call may wait on the wall clock in the child before it is taken never to settle. A
// call of one function with one set of values takes microseconds to milliseconds, and the simulated
// world answers at once, so ten seconds is far past any call that is going to settle, and short
// enough that a call that never does holds the run up for little time.
//
export const callWallMs = 10000;

//
// How far past the moment a call settled the timers it left behind still run, in simulated time.
// A minute takes in the retries and back-offs a call sets going as it ends, and stops an interval
// that never ends from keeping the run going.
//
export const afterSettleMs = 60000;

//
// How long the worker waits for the child to answer a call before it kills it: twice the child's
// own limit, so a call that is waiting is answered by the child when its limit passes, and only a
// call that never gives the child back control (a loop that never ends) is killed.
//
export const killAfterMs = callWallMs * 2;

//
// How long opening a shard may take: reading it and every file it imports with the compiler and
// loading it. The slowest open measured on 2026-10-26, over every file of a real project of 135
// source files run with two workers, took 9.9 seconds. Three times that leaves room for a slower
// machine, and a file whose top level never finishes is reported after that long rather than
// holding a worker up.
//
export const openLimitMs = 30000;

//
// How many calls one child makes before it is started again. Every call loads copies of the
// project's modules, which stay in the child's memory until it ends, and a coverage reading costs
// time for every copy the child holds, so the child is started again before they grow without
// bound; starting it costs opening the shard again. Measured on 2026-10-26, with a coverage
// reading every `callsPerReadingMost` calls, over the file of a real project that makes the most
// calls: 19.2 s with a restart every 1000 calls against 30.7 s with one every 250, and 39.5 s
// against 40.0 s on another file.
//
export const callsPerChildMost = 1000;

//
// How many calls a child makes before it takes a coverage reading, when no reading is asked for
// sooner. A reading costs time for every module the child holds, and the run needs only what the
// calls together exercised, so most calls leave their counts for the next reading. The stop rule
// sees a function's code paths that much later, so a function makes at most that many calls more
// than it needs. Measured on 2026-10-26 over the 1,400 calls of one file of a real project, with
// the same coverage each time: 39.2 s reading after every call, 28.8 s every 8 calls and 27.9 s
// every 16, so 8 keeps most of the saving with half the delay.
//
export const callsPerReadingMost = 8;

//
// The settings a run starts every worker with: the Node running Faultline, the limits above and
// the sim types where Faultline's own modules declare them, as TypeScript in a clone and as
// declarations in an installed copy.
//
export function defaultWorkerSettings(projectRoot: string, toolModules: string, childEntry: string): IWorkerSettings {
    assert(path.isAbsolute(projectRoot));
    assert(path.isAbsolute(childEntry));
    return {
        nodePath: process.execPath,
        childEntry,
        child: {
            projectRoot,
            toolModules,
            simTypes: [path.join(toolModules, "sim", "index.ts"), path.join(toolModules, "sim", "index.d.ts")],
            limits: {
                wallMs: callWallMs,
                afterSettleMs,
            },
        },
        killAfterMs,
        openLimitMs,
        callsPerChild: callsPerChildMost,
        callsPerReading: callsPerReadingMost,
    };
}

//
// What a worker needs to start its child.
//
export interface IWorkerSettings {
    //
    // The Node program the child runs under.
    //
    nodePath: string;

    //
    // The file the child runs: `run/child-main` in Faultline's own modules.
    //
    childEntry: string;

    //
    // What the child is started with.
    //
    child: IChildSettings;

    //
    // How long a call may go unanswered before it is taken never to return and the child is killed.
    // It is longer than the child's own wall-clock limit, so a call that waits is answered by the
    // child and only a call that never gives the child back control is killed.
    //
    killAfterMs: number;

    //
    // How long opening a shard may take before the child is killed: reading it with the compiler
    // and loading its files.
    //
    openLimitMs: number;

    //
    // How many calls one child makes before it is started again.
    //
    callsPerChild: number;

    //
    // How many calls one child makes before it takes a coverage reading, when no reading is asked
    // for sooner.
    //
    callsPerReading: number;
}

//
// A worker: the executor of one shard at a time, and a way to end its child.
//
export interface IWorker extends IShardExecutor {
    //
    // Ends the child, waiting for it to go.
    //
    stop(): Promise<void>;
}

//
// The error stream of a child process, as the worker reads it.
//
export interface IErrorStream {
    //
    // Makes the stream hand over text rather than bytes.
    //
    setEncoding(encoding: BufferEncoding): void;

    //
    // Calls `listener` with each piece of text the child writes.
    //
    on(event: "data", listener: (text: string) => void): void;
}

//
// What the worker uses of a child process. A real child is started by `WorkerFactory`, and a test
// passes in a factory whose children answer from a script, so the worker is tested without
// starting a process.
//
export interface IChildProcess {
    //
    // The code the child exited with, or null while it runs or when a signal ended it.
    //
    readonly exitCode: number | null;

    //
    // The signal that ended the child, or null while it runs or when it exited.
    //
    readonly signalCode: NodeJS.Signals | null;

    //
    // What the child writes on its error stream.
    //
    readonly stderr: IErrorStream | null;

    //
    // Sends the child a request.
    //
    send(message: IRequest): boolean;

    //
    // Ends the child with a signal.
    //
    kill(signal: NodeJS.Signals): boolean;

    //
    // Listens for the child's replies, its end and an error on the channel to it.
    //
    on(event: "message", listener: (message: IReply) => void): void;
    on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): void;
    on(event: "error", listener: (error: Error) => void): void;

    //
    // Listens once for the child's end.
    //
    once(event: "exit", listener: () => void): void;
}

//
// Starts the child processes a worker sends its requests to.
//
export interface IWorkerFactory {
    //
    // Starts one child with the worker's settings.
    //
    create(settings: IWorkerSettings): IChildProcess;
}

//
// Starts the real child: `run/child-main` under the Node the settings name, with the child's
// settings as its one argument, its error stream piped back and a JSON channel to the worker.
//
export class WorkerFactory implements IWorkerFactory {
    //
    // Forks one child, which talks to the worker over the channel and nothing else.
    //
    create(settings: IWorkerSettings): IChildProcess {
        assert(path.isAbsolute(settings.nodePath));
        assert(path.isAbsolute(settings.childEntry));
        const child = fork(settings.childEntry, [JSON.stringify(settings.child)], {
            execPath: settings.nodePath,
            execArgv: [],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
            serialization: "json",
        });
        assert(child.stderr !== null);
        return child;
    }
}

//
// What a worker keeps between one request and the next.
//
export interface IWorkerState {
    //
    // How the child is started.
    //
    settings: IWorkerSettings;

    //
    // Starts a child.
    //
    factory: IWorkerFactory;

    //
    // The child, or undefined when none is running.
    //
    child: IChildProcess | undefined;

    //
    // The end of what the child wrote on its error stream.
    //
    errors: string;

    //
    // The shard the worker is on, which a new child opens before its first call.
    //
    shard: IOpenRequest | undefined;

    //
    // Whether the running child has the shard open.
    //
    isOpen: boolean;

    //
    // How many calls the running child has made.
    //
    calls: number;

    //
    // The replay tokens of the calls the running child has made in the open shard since its last
    // coverage reading. A child that ends before it takes the reading takes those counts with it,
    // so a new child makes the calls again and reads what they exercised: every call loads its own
    // copies of the modules, so it exercises the same code paths again.
    //
    unread: string[];

    //
    // How the last open of the shard the worker is on failed, or undefined when it did not. The
    // calls of a shard that failed to open are answered from it, so the file is opened once.
    //
    failedOpen: IFailedOpen | undefined;

    //
    // The request waiting on the child's answer, or undefined when none is. The worker sends one
    // request at a time, so one is all there can be.
    //
    pending: IPendingAnswer | undefined;
}

//
// How an open of a shard failed.
//
export interface IFailedOpen {
    //
    // How the child ended while opening it, or undefined when it was killed because the open
    // did not finish within the limit.
    //
    ended: string | undefined;
}

//
// A request sent to the child that has not been answered yet. The listeners on the child stay the
// same for its whole life and answer whichever request is pending, so no listener is added per
// request and none is left behind on a child that serves many calls.
//
export interface IPendingAnswer {
    //
    // Hands the answer to whoever sent the request.
    //
    resolve(answer: IAnswer): void;

    //
    // Kills the child when the request's limit passes unanswered.
    //
    timer: NodeJS.Timeout;
}

//
// What came back from asking the child something.
//
export interface IAnswer {
    //
    // The child's reply, when it gave one.
    //
    reply: IReply | undefined;

    //
    // Why the child ended without replying, when it did.
    //
    ended: string | undefined;
}

//
// Builds a worker whose children are started by `factory`. No child is started until the first
// request.
//
export function createWorker(settings: IWorkerSettings, factory: IWorkerFactory): IWorker {
    assert(settings.killAfterMs > settings.child.limits.wallMs);
    assert(settings.openLimitMs > 0);
    assert(settings.callsPerChild > 0);
    assert(settings.callsPerReading > 0);
    const state: IWorkerState = {
        settings,
        factory,
        child: undefined,
        errors: "",
        shard: undefined,
        isOpen: false,
        calls: 0,
        unread: [],
        failedOpen: undefined,
        pending: undefined,
    };
    return {
        open: (request: IOpenRequest) => openShard(state, request),
        call: (token: string) => callChild(state, token),
        read: () => readUnread(state),
        stop: () => stopChild(state),
    };
}

//
// Starts the child and listens to it for the whole of its life.
//
export function startChild(state: IWorkerState): IChildProcess {
    assert(state.child === undefined);
    assert(state.pending === undefined);
    const child = state.factory.create(state.settings);
    const stderr = child.stderr;
    assert(stderr !== null, "The child process was started without a pipe for its error stream.");
    state.errors = "";
    state.calls = 0;
    stderr.setEncoding("utf8");
    stderr.on("data", (text: string) => {
        state.errors = `${state.errors}${text}`.slice(-keptErrorLength);
    });
    //
    // A request sent to a child that has just ended fails here rather than at the call that sent
    // it. The child's exit, which follows, is what the waiting request is answered with.
    //
    child.on("error", (error: Error) => {
        state.errors = `${state.errors}${error.message}\n`.slice(-keptErrorLength);
    });
    //
    // A child the worker has killed for taking too long may still reply. Its request was answered
    // as never returning when it was killed, so the late reply has no request left to answer.
    //
    child.on("message", (message: IReply) => {
        if (state.child === child) {
            deliverAnswer(state, {
                reply: message,
                ended: undefined,
            });
        }
    });
    //
    // A child can end between requests as well as during one, and the next request then starts a
    // new child rather than writing to one that is gone. A child the worker killed or stopped is
    // no longer its child, and its end answers no request.
    //
    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        if (state.child === child) {
            state.child = undefined;
            state.isOpen = false;
            if (state.pending !== undefined) {
                deliverAnswer(state, {
                    reply: undefined,
                    ended: endedBecause(code, signal, state.errors),
                });
            }
        }
    });
    state.child = child;
    state.isOpen = false;
    return child;
}

//
// Sends the child one request and waits for its reply, for it to end or for `limitMs` to pass. A
// child that has not replied when the time is up is killed.
//
export function ask(state: IWorkerState, request: IRequest, limitMs: number): Promise<IAnswer> {
    assert(state.pending === undefined, "A request was sent to the child while another was waiting.");
    assert(limitMs > 0);
    const child = state.child ?? startChild(state);
    return new Promise((resolve) => {
        state.pending = {
            resolve,
            timer: setTimeout(() => {
                killChild(state);
                deliverAnswer(state, {
                    reply: undefined,
                    ended: undefined,
                });
            }, limitMs),
        };
        child.send(request);
    });
}

//
// Answers the pending request and stops its timer, so the next request can be sent.
//
export function deliverAnswer(state: IWorkerState, answer: IAnswer): void {
    const pending = state.pending;
    assert(pending !== undefined, "The child answered when no request was waiting.");
    if (answer.reply !== undefined) assert(answer.ended === undefined);
    clearTimeout(pending.timer);
    state.pending = undefined;
    pending.resolve(answer);
}

//
// Why a child ended, as the end of a sentence. Node gives an exit code when the child exited and a
// signal when one ended it, never both.
//
export function endedBecause(code: number | null, signal: string | null, errors: string): string {
    let cause: string;
    if (signal === null) {
        assert(code !== null);
        cause = `with exit code ${code}`;
    }
    else {
        assert(code === null);
        cause = `with the signal ${signal}`;
    }
    const written = errors.trim();
    if (written.length === 0) {
        return cause;
    }
    return `${cause}, saying: ${written}`;
}

//
// Kills the child, which then starts again before the next request.
//
export function killChild(state: IWorkerState): void {
    if (state.isOpen) assert(state.child !== undefined);
    const child = state.child;
    if (child === undefined) {
        return;
    }
    child.kill("SIGKILL");
    state.child = undefined;
    state.isOpen = false;
}

//
// Opens a shard in the child, starting one when none is running. A child that cannot open it is
// gone by the time the answer comes (it ended or it was killed when the limit passed), and the
// shard is described with only its top level, so the call that loads the file is reported with its
// replay token, answered from how the open failed rather than by opening the file again.
//
export async function openShard(state: IWorkerState, request: IOpenRequest): Promise<IShardFacts> {
    state.shard = request;
    state.isOpen = false;
    state.failedOpen = undefined;

    //
    // The child throws away the reading opening a shard takes, so counts left unread from the shard
    // before go with it. A run reads at the end of every function, so none are left.
    //
    state.unread = [];
    const answer = await ask(state, request, state.settings.openLimitMs);
    if (answer.reply !== undefined) {
        assert(isOpenedReply(answer.reply), "The child answered an open request with something else.");
        assert.equal(answer.reply.shard.file, request.file);
        state.isOpen = true;
        return answer.reply.shard;
    }
    assert(state.child === undefined);
    state.failedOpen = {
        ended: answer.ended,
    };
    let reason: string;
    if (answer.ended === undefined) {
        reason = `did not finish within ${state.settings.openLimitMs} milliseconds`;
    }
    else {
        reason = `ended ${answer.ended}`;
    }
    const facts = emptyFacts(request.file, [], `The child process opening ${request.file} ${reason}.`);
    if (!isSimFile(request.file)) {
        facts.functions.push({
            label: topLevelLabel,
            name: topLevelLabel,
            line: 1,
            uncallable: undefined,
            unbuildable: undefined,
            choices: [],
            targets: [pathKey(request.file, `${topLevelLabel}:entered`)],
        });
    }
    return facts;
}

//
// Makes one call in the child, opening the worker's shard first in a child that has not.
//
export async function callChild(state: IWorkerState, token: string): Promise<ICallResult> {
    const shard = state.shard;
    assert(shard !== undefined, "A call was made before any shard was opened.");
    if (state.isOpen) assert(state.child !== undefined);
    if (state.failedOpen !== undefined) {
        assert(!state.isOpen);
        return failedOpenCall(token, state.failedOpen.ended);
    }
    if (!state.isOpen) {
        const opened = await ask(state, shard, state.settings.openLimitMs);
        if (opened.reply === undefined) {
            assert(state.child === undefined);
            return failedCall(token, opened.ended);
        }
        assert(isOpenedReply(opened.reply), "The child answered an open request with something else.");
        state.isOpen = true;
    }
    const reading = state.unread.length + 1 >= state.settings.callsPerReading;
    const request: ICallRequest = {
        kind: "call",
        token,
        read: reading,
    };
    const answer = await ask(state, request, state.settings.killAfterMs);
    if (answer.reply === undefined) {
        assert(state.child === undefined);
        const lost = state.unread;
        state.unread = [];
        const failed = failedCall(token, answer.ended);
        failed.exercised.push(...await callAgain(state, shard, lost));
        return failed;
    }
    assert(isCalledReply(answer.reply), "The child answered a call with something else.");
    const result = answer.reply.result;
    assert.equal(result.token, token);
    if (reading) {
        state.unread = [];
    }
    else {
        state.unread.push(token);
    }
    state.calls += 1;
    if (state.calls < state.settings.callsPerChild) {
        return result;
    }
    result.exercised.push(...await readUnread(state));
    await stopChild(state);
    return result;
}

//
// Takes a coverage reading of the calls the child has made since its last one, or reads nothing
// when it has made none. A child that ends while reading has its calls made again in a new one.
//
export async function readUnread(state: IWorkerState): Promise<string[]> {
    if (state.unread.length === 0) {
        return [];
    }
    const shard = state.shard;
    assert(shard !== undefined, "Calls were left unread with no shard open.");
    assert(state.isOpen, "Calls were left unread in a child that has not the shard open.");
    const request: IReadRequest = {
        kind: "read",
    };
    const answer = await ask(state, request, state.settings.killAfterMs);
    const lost = state.unread;
    state.unread = [];
    if (answer.reply === undefined) {
        assert(state.child === undefined);
        return callAgain(state, shard, lost);
    }
    assert(isReadReply(answer.reply), "The child answered a read request with something else.");
    return answer.reply.exercised;
}

//
// Makes `tokens` again in a new child, reading after the last, and gives what they exercised. They
// are calls the child that ended had answered but not read, so each answers again as it did. When
// the shard does not open again, or one of them is not answered again, what they exercised cannot
// be read and none of it is given.
//
export async function callAgain(state: IWorkerState, shard: IOpenRequest, tokens: string[]): Promise<string[]> {
    assert(tokens.length < state.settings.callsPerReading);
    if (tokens.length === 0) {
        return [];
    }
    assert(state.child === undefined);
    const opened = await ask(state, shard, state.settings.openLimitMs);
    if (opened.reply === undefined) {
        return [];
    }
    assert(isOpenedReply(opened.reply), "The child answered an open request with something else.");
    state.isOpen = true;
    let exercised: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const request: ICallRequest = {
            kind: "call",
            token: tokens[index]!,
            read: index === tokens.length - 1,
        };
        const answer = await ask(state, request, state.settings.killAfterMs);
        if (answer.reply === undefined) {
            return [];
        }
        assert(isCalledReply(answer.reply), "The child answered a call with something else.");
        state.calls += 1;
        exercised = answer.reply.result.exercised;
    }
    return exercised;
}

//
// Whether a message from the child answers a call. `messages.ts` offers a guard for the answer to
// an open request only, and the worker needs this one to read a call's result without a cast.
//
export function isCalledReply(message: IReply): message is ICalledReply {
    return message.kind === "called";
}

//
// What a call the child never answered is: a call that never returned when the child was killed for
// taking too long, and a crash when the child ended part way through it.
//
export function failedCall(token: string, ended: string | undefined): ICallResult {
    const parsed = readToken(token);
    assert(parsed.ok, "A call the child never answered has a replay token that cannot be read.");
    const call = parsed.value;
    const described = subjectOf(isSimFile(call.file), call.name);
    let failure: IFailure;
    if (ended === undefined) {
        failure = judgeHang(call.file, call.name, described, token);
    }
    else {
        failure = {
            kind: "crash",
            message: `${described} ended the process running it ${ended}.`,
            location: "",
            key: `crash|ended|${call.file}|${call.name}`,
            token,
            stack: "",
        };
    }
    assert.equal(failure.token, token);
    return {
        token,
        exercised: [],
        reached: [],
        injected: false,
        failures: [failure],
        arguments: [],
    };
}

//
// The result of a call of a shard that failed to open, made without opening it again: a call that
// never returned when the open did not finish within the limit, and a failed open when the child
// ended while opening it.
//
export function failedOpenCall(token: string, ended: string | undefined): ICallResult {
    const parsed = readToken(token);
    assert(parsed.ok, "A call of a shard that failed to open has a replay token that cannot be read.");
    const call = parsed.value;
    const described = subjectOf(isSimFile(call.file), call.name);
    let failure: IFailure;
    if (ended === undefined) {
        failure = judgeHang(call.file, call.name, described, token);
    }
    else {
        failure = judgeFailedOpen(call.file, described, ended, token);
    }
    assert.equal(failure.token, token);
    return {
        token,
        exercised: [],
        reached: [],
        injected: false,
        failures: [failure],
        arguments: [],
    };
}

//
// Ends the child and waits for it to go. The child keeps nothing that has to be written out, so it
// is killed rather than asked.
//
export async function stopChild(state: IWorkerState): Promise<void> {
    assert(state.pending === undefined, "The child was stopped while a request was waiting on it.");
    if (state.isOpen) assert(state.child !== undefined);
    const child = state.child;
    if (child === undefined) {
        return;
    }
    state.child = undefined;
    state.isOpen = false;
    if (child.exitCode !== null) {
        return;
    }
    if (child.signalCode !== null) {
        return;
    }
    await new Promise<void>((resolve) => {
        child.once("exit", () => {
            resolve();
        });
        child.kill("SIGKILL");
    });
}
