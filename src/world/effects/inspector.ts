// The replaced `node:inspector`.
//
// A session opened here talks to the one V8 the run is being counted in. Code under test that opens
// one and starts precise coverage resets the counters the run is measured by, so everything counted
// since the last reading is lost, and one that disconnects takes the run's own reading with it.
// This tool's own driver opens one, and a run measuring that file read every path of it as
// unreached while the calls that ran them were counted in the hundreds.
//
// So a session answers without reaching V8. What a caller posts is taken and answered the way one
// connected to nothing answers it, and the events a caller listens for never arrive, because a
// session connected to nothing has nothing to say.

import { EventEmitter } from "node:events";

// What a caller gets back from a post it asked for an answer to.
type Answer = (error: Error | null, result?: unknown) => void;

// What a post of `Profiler.takePreciseCoverage` answers with, which is the one call a caller reads
// something out of.
const nothingCounted = { result: [] };

// A session that is connected to nothing.
//
// It is an event emitter, so a caller that listens for one of the protocol's events registers a
// listener the way it always does. None of them ever arrives.
export class Session extends EventEmitter {
    // Whether `connect` has been called. A post before that fails the way the real one fails.
    private open = false;

    // Opens the session, which opens nothing.
    connect(): void {
        this.open = true;
    }

    // The same, from a worker.
    connectToMainThread(): void {
        this.open = true;
    }

    // Closes it again.
    disconnect(): void {
        this.open = false;
    }

    // Takes one call and answers it. A caller that asked for no answer is left alone, and one that
    // posts before connecting is refused the way the real session refuses it.
    post(method: string, answer: Answer): void;
    post(method: string, params?: unknown, answer?: Answer): void;
    post(method: string, paramsOrAnswer?: unknown, answer?: Answer): void {
        const called = typeof paramsOrAnswer === "function" ? (paramsOrAnswer as Answer) : answer;
        if (called === undefined) {
            return;
        }
        if (!this.open) {
            called(new Error("Session is not connected"));
            return;
        }
        called(null, method === "Profiler.takePreciseCoverage" ? nothingCounted : {});
    }
}

// Opens the inspector on a port, which a run does not do: nothing outside a run connects to it.
export function open(): void {}

// Closes it again.
export function close(): void {}

// The address it would be reached on, which is none while it is not open.
export function url(): undefined {
    return undefined;
}

// Waits for something to connect, which nothing does.
export function waitForDebugger(): void {}

// The console a caller writes to. The real module's goes to whatever is debugging the process, and
// a run has nothing debugging it, so this is the ordinary one the run already replaces the writing
// of.
export const console = globalThis.console;

export default { Session, open, close, url, waitForDebugger, console };
