// The globals a run replaces, so code that reads the clock, draws a random number, waits, fetches,
// reads an environment variable, writes output or exits is exercised against the simulated world
// without declaring anything.
//
// Every replacement asks for the run in flight. When there is none the real one is called, so the
// tool's own clock, timers, network and output are its own and a project loaded but not yet driven
// behaves.
//
// A global the runtime does not have is left alone.

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import util from "node:util";
import { isDriving, nowRunning } from "./current.ts";
import type { RunClock } from "./clock.ts";

// The machine's own clock, held from before anything was replaced.
//
// The tool times itself, and a run measuring this very file loads a copy of it which replaces the
// clock of the process the driver is in. The driver reading the replaced one then gets whatever the
// code under test was given, and a made up clock that throws takes the whole run down with it.
export const realNow = Date.now.bind(Date);

// What was there before, kept so a replacement can fall through to it and so a run can put the
// runtime back as it found it.
interface Held {
    // Where the value sat.
    on: object;

    // What it was called.
    name: string;

    // How it was declared, so putting it back leaves the runtime as it was found.
    was?: PropertyDescriptor;
}

// Everything this process replaced, newest first, so putting it back is walking the list.
//
// It is held by the module because a replaced global is held by the process: the globals are
// replaced once, before the project is loaded, and put back once, and nothing above this module
// lives that long.
const replaced: Held[] = [];

// Puts `value` in place of `on[name]`, remembering how it was declared. A name the runtime does not
// have is left alone rather than added, because code that checks for a global before using it would
// otherwise take a path the real runtime never gives it.
export function put(on: object, name: string, value: unknown): void {
    define(on, name, {
        value,
        writable: true,
        configurable: true,
    });
}

// Puts a getter in place of `on[name]`, for a property read afresh each time, such as
// `process.stdout`, which is a different stream while a run is in flight.
function putGetter(on: object, name: string, read: () => unknown): void {
    define(on, name, {
        get: read,
        configurable: true,
    });
}

// Defines `on[name]` as `descriptor`, remembering how it was declared.
//
// It is defined rather than assigned, because a runtime declares some of its globals with a getter
// and no setter, and assigning to one of those changes nothing.
function define(on: object, name: string, descriptor: PropertyDescriptor): void {
    if (!(name in on)) {
        return;
    }
    const was = Object.getOwnPropertyDescriptor(on, name);
    try {
        Object.defineProperty(on, name, {
            ...descriptor,
            enumerable: was?.enumerable ?? false,
        });
    }
    catch {
        // A runtime that will not let one of its own globals be replaced keeps it, and the code
        // under test reaches the real one. Everything else is still replaced.
        return;
    }
    replaced.push({
        on,
        name,
        was,
    });
}

// Replaces every global a run controls. Calling it twice replaces nothing the second time.
export function installGlobals(): void {
    if (replaced.length > 0) {
        return;
    }
    const global = globalThis as unknown as Record<string, unknown>;
    installClock(global);
    installTimers(global);
    installRandom(global);
    installFetch(global);
    installProcess(process);
    installConsole(console);
    installWebGlobals(global);
    installEntryCheck(global);
}

//
// The name of the global a loaded project file asks whether it is the process's entry point, in
// place of reading `import.meta.main`, which Node sets only for the file it started. It is a name
// of Faultline's own, so no project names it.
//
export const entryCheckName = "__faultlineIsEntryPoint";

//
// Adds the global `entryCheckName` names: whether the module at a URL, a copy of a project file, is
// the file the scenario in flight started as the process's entry point.
//
export function installEntryCheck(global: Record<string, unknown>): void {
    assert(!(entryCheckName in global), `The global ${entryCheckName} is already there.`);
    Object.defineProperty(global, entryCheckName, {
        value: (url: string): boolean => {
            const running = nowRunning();
            if (!running?.entryFile) {
                return false;
            }
            return fileURLToPath(url) === running.entryFile;
        },
        configurable: true,
        writable: false,
        enumerable: false,
    });
    replaced.push({
        on: global,
        name: entryCheckName,
    });
}

// Replaces the clock the code under test reads through `new Date()`, `Date.now()` and
// `performance.now()`. Everything else a date does is the real thing, so parsing, formatting and
// arithmetic are unchanged.
export function installClock(global: Record<string, unknown>): void {
    const realDate = Date;

    class RunDate extends realDate {
        constructor(...args: unknown[]) {
            if (args.length === 0) {
                super(RunDate.now());
                return;
            }
            // @ts-expect-error The arguments are whatever the caller passed, and Date takes them.
            super(...args);
        }

        static override now(): number {
            return nowRunning()?.clock.now() ?? realDate.now();
        }
    }

    put(global, "Date", RunDate);
    const performanceOf = global.performance as { now?: () => number } | undefined;
    if (performanceOf?.now !== undefined) {
        const realMonotonic = performanceOf.now.bind(performanceOf);
        put(performanceOf, "now", (): number => nowRunning()?.clock.monotonic() ?? realMonotonic());
    }
}

// The handle a timer set while a run is in flight is handed back as. It has what Node's own has,
// so code under test that calls `unref` on it or turns it into a number gets past it.
export class RunTimer {
    // The id the clock knows the timer by.
    readonly id: number;

    // The clock the timer was set on, so clearing it clears it there whichever run is in flight.
    readonly clock: RunClock;

    // Whether the timer keeps the process alive, as `ref` and `unref` set it.
    private referenced = true;

    constructor(id: number, clock: RunClock) {
        this.id = id;
        this.clock = clock;
    }

    ref(): this {
        this.referenced = true;
        return this;
    }

    unref(): this {
        this.referenced = false;
        return this;
    }

    hasRef(): boolean {
        return this.referenced;
    }

    // Starts the wait again, which a simulated timer does not need: it runs when the clock reaches
    // it, however it was set.
    refresh(): this {
        return this;
    }

    close(): this {
        this.clock.clearTimer(this.id);
        return this;
    }

    [Symbol.toPrimitive](): number {
        return this.id;
    }

    [Symbol.dispose](): void {
        this.close();
    }
}

// Sets a timer on the run in flight, or none when no run is in flight or `work` is not a function,
// which Node refuses.
export function setRunTimer(work: unknown, delayMs: unknown, args: unknown[], repeats: boolean): RunTimer | undefined {
    const running = nowRunning();
    if (running === undefined || typeof work !== "function") {
        return undefined;
    }
    const id = running.clock.setTimer(delayMs, () => (work as (...given: unknown[]) => void)(...args), repeats);
    return new RunTimer(id, running.clock);
}

//
// The most milliseconds `AbortSignal.timeout` takes, which is Node's own limit on it.
//
export const timeoutSignalMsMost = 4294967295;

//
// A signal that aborts when the run's clock reaches `delayMs`, as `AbortSignal.timeout` gives on
// the machine's clock, or undefined when no run is in flight or the delay is one Node refuses, so
// the real call answers it the way it always does. The machine's own would wait on the real clock,
// and on 2026-10-26 calls of a real project that set a half-second timeout each waited half a
// second for it.
//
export function runTimeoutSignal(delayMs: unknown): AbortSignal | undefined {
    const running = nowRunning();
    if (running === undefined) {
        return undefined;
    }
    if (typeof delayMs !== "number") {
        return undefined;
    }
    if (!Number.isInteger(delayMs)) {
        return undefined;
    }
    if (delayMs < 0) {
        return undefined;
    }
    if (delayMs > timeoutSignalMsMost) {
        return undefined;
    }
    const controller = new AbortController();
    running.clock.setTimer(delayMs, () => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")), false);
    assert(!controller.signal.aborted);
    return controller.signal;
}

// Clears a timer set on a run. A handle of the machine's own timers is handed back for the real
// call to clear.
export function clearRunTimer(handle: unknown): boolean {
    if (handle instanceof RunTimer) {
        handle.close();
        return true;
    }
    return false;
}

// Replaces the timers, so a call that waits costs a run no time at all. A timer set while a run is
// in flight waits on the run's clock, and the run loop runs it when the clock reaches it, in the
// order the timers are due.
//
// A timer set when no run is in flight is the real one, so the tool's own waiting still waits.
function installTimers(global: Record<string, unknown>): void {
    const realSetTimeout = global.setTimeout as (...args: unknown[]) => unknown;
    const realSetInterval = global.setInterval as (...args: unknown[]) => unknown;
    const realClearTimeout = global.clearTimeout as (handle: unknown) => void;
    const realClearInterval = global.clearInterval as (handle: unknown) => void;

    put(global, "setTimeout", (work: unknown, delayMs?: unknown, ...args: unknown[]): unknown => {
        return setRunTimer(work, delayMs, args, false) ?? realSetTimeout(work, delayMs, ...args);
    });
    put(global, "setInterval", (work: unknown, delayMs?: unknown, ...args: unknown[]): unknown => {
        return setRunTimer(work, delayMs, args, true) ?? realSetInterval(work, delayMs, ...args);
    });
    put(global, "clearTimeout", (handle: unknown): void => {
        if (!clearRunTimer(handle)) {
            realClearTimeout(handle);
        }
    });
    put(global, "clearInterval", (handle: unknown): void => {
        if (!clearRunTimer(handle)) {
            realClearInterval(handle);
        }
    });
    const realTimeoutSignal = AbortSignal.timeout.bind(AbortSignal);
    put(AbortSignal, "timeout", (delayMs: number): AbortSignal => runTimeoutSignal(delayMs) ?? realTimeoutSignal(delayMs));
}

// Replaces `Math.random` and the web crypto's random calls with the run's seeded generator, so a
// replay draws the same numbers.
export function installRandom(global: Record<string, unknown>): void {
    const realRandom = Math.random.bind(Math);
    put(Math, "random", (): number => nowRunning()?.rng.next() ?? realRandom());

    const cryptoOf = global.crypto as { randomUUID?: () => string; getRandomValues?: (into: ArrayBufferView) => ArrayBufferView } | undefined;
    if (cryptoOf?.randomUUID !== undefined) {
        const realUuid = cryptoOf.randomUUID.bind(cryptoOf);
        put(cryptoOf, "randomUUID", (): string => nowRunning()?.rng.uuid() ?? realUuid());
    }
    if (cryptoOf?.getRandomValues !== undefined) {
        const realValues = cryptoOf.getRandomValues.bind(cryptoOf);
        put(cryptoOf, "getRandomValues", <T extends ArrayBufferView>(into: T): T => {
            const running = nowRunning();
            if (running === undefined) {
                return realValues(into) as T;
            }
            new Uint8Array(into.buffer, into.byteOffset, into.byteLength).set(running.rng.bytes(into.byteLength));
            return into;
        });
    }
}

// Replaces `fetch` with the run's network.
export function installFetch(global: Record<string, unknown>): void {
    if (typeof global.fetch !== "function") {
        return;
    }
    const realFetch = (global.fetch as typeof fetch).bind(global);
    put(global, "fetch", (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const running = nowRunning();
        if (running === undefined) {
            return realFetch(input, init);
        }
        return running.network.fetch(input, init);
    });
}

// Replaces what the code under test reaches on `process`: the environment, the standard streams,
// the working directory, exiting and the one call that sends to the process that started this one.
function installProcess(target: NodeJS.Process): void {
    const realEnv = target.env;
    const realStdin = target.stdin;
    const realStdout = target.stdout;
    const realStderr = target.stderr;
    const realCwd = target.cwd.bind(target);
    const realChdir = target.chdir.bind(target);
    const realExit = target.exit.bind(target);

    put(target, "env", new Proxy(realEnv, environmentHandler));
    putGetter(target, "stdin", () => nowRunning()?.stdin ?? realStdin);
    putGetter(target, "stdout", () => nowRunning()?.stdout ?? realStdout);
    putGetter(target, "stderr", () => nowRunning()?.stderr ?? realStderr);
    put(target, "cwd", (): string => nowRunning()?.files.cwd() ?? realCwd());
    put(target, "chdir", (to: string): void => {
        const running = nowRunning();
        if (running === undefined) {
            realChdir(to);
            return;
        }
        running.files.chdir(to);
    });
    //
    // `process.argv` is a plain value Node puts on the process, so its descriptor is always there.
    //
    const realArgv = Object.getOwnPropertyDescriptor(target, "argv");
    assert(realArgv !== undefined, "The process has no argv.");
    define(target, "argv", {
        get: (): unknown => {
            const running = nowRunning();
            if (running) {
                running.processArgv ??= [...realArgv.value];
                return running.processArgv;
            }
            return realArgv.value;
        },
        set: (value: string[]): void => {
            const running = nowRunning();
            if (running) {
                running.processArgv = value;
                return;
            }
            realArgv.value = value;
        },
        configurable: true,
    });
    put(target, "exit", (code?: unknown): never => {
        const running = nowRunning();
        if (running === undefined) {
            return realExit(code as number | undefined);
        }
        throw running.exit(code);
    });
    installSending(target);
}

// How `process.env` answers while a run is in flight: from the run's own environment. With no run
// in flight it is the machine's, so the tool reads its own. Node reads a few variables of its own
// through `process.env` while it loads a module the call imports, and those reads are the machine's
// too, because they are Node's and not the code under test's.
const environmentHandler: ProxyHandler<NodeJS.ProcessEnv> = {
    get(real, name) {
        const running = nowRunning();
        if (running === undefined || typeof name !== "string" || isReadByNode()) {
            return Reflect.get(real, name);
        }
        return running.environment.read(name);
    },
    set(real, name, value) {
        const running = nowRunning();
        if (running === undefined || typeof name !== "string") {
            return Reflect.set(real, name, value);
        }
        running.environment.set(name, value);
        return true;
    },
    deleteProperty(real, name) {
        const running = nowRunning();
        if (running === undefined || typeof name !== "string") {
            return Reflect.deleteProperty(real, name);
        }
        running.environment.unset(name);
        return true;
    },
    has(real, name) {
        const running = nowRunning();
        if (running === undefined || typeof name !== "string") {
            return Reflect.has(real, name);
        }
        return running.environment.has(name);
    },
    ownKeys(real) {
        const running = nowRunning();
        if (running === undefined) {
            return Reflect.ownKeys(real);
        }
        return running.environment.names();
    },
    getOwnPropertyDescriptor(real, name) {
        const running = nowRunning();
        if (running === undefined || typeof name !== "string") {
            return Reflect.getOwnPropertyDescriptor(real, name);
        }
        if (!running.environment.has(name)) {
            return undefined;
        }
        return {
            value: running.environment.read(name),
            writable: true,
            enumerable: true,
            configurable: true,
        };
    },
};

// Whether the read of `process.env` being answered was made by Node's own code, whose frames name a
// `node:` module, rather than by the code under test. The frames are read as call sites, so no
// stack is formatted: formatting one would read the working directory.
export function isReadByNode(): boolean {
    // This function, the trap asking and the code that made the read.
    const sites = util.getCallSites(3);
    return sites[2]?.scriptName.startsWith("node:") === true;
}

// Replaces the one call that sends to the process that started this one.
//
// It is the channel the worker reports on, and a run drives the tool's own code like any other. A
// made up value passed to the call that sends is a made up message on that channel, so while the
// driving is on the code under test sends nothing. The worker holds the call as it was before any
// of this was replaced, so its own word still gets through. A runtime with no such call is left
// alone.
export function installSending(target: NodeJS.Process): void {
    if (target.send === undefined) {
        return;
    }
    const realSend = target.send.bind(target);
    put(target, "send", (...args: unknown[]): boolean => {
        if (!isDriving()) {
            return (realSend as (...given: unknown[]) => boolean)(...args);
        }
        return true;
    });
}

// Replaces every method of `console`, so what the code under test logs is kept on the run's output
// and not shown.
function installConsole(target: Console): void {
    const real = target as unknown as Record<string, unknown>;
    for (const name of Object.keys(real)) {
        const method = real[name];
        if (typeof method !== "function") {
            continue;
        }
        const realMethod = (method as (...args: unknown[]) => unknown).bind(target);
        put(target, name, (...args: unknown[]): unknown => {
            const running = nowRunning();
            if (running === undefined) {
                return realMethod(...args);
            }
            return ((running.console as unknown as Record<string, (...given: unknown[]) => unknown>)[name])!(...args);
        });
    }
}

// Replaces the socket and the two stores, which Node has as globals of its own. A runtime without
// them is left alone.
export function installWebGlobals(global: Record<string, unknown>): void {
    if (typeof global.WebSocket === "function") {
        put(global, "WebSocket", RunSocket);
    }
    for (const name of ["localStorage", "sessionStorage"]) {
        if (global[name] !== undefined) {
            put(global, name, new RunStorage());
        }
    }
}

// What opening a socket can fail with.
const socketFailures = ["name-does-not-resolve", "connection-refused", "connection-times-out", "network-unreachable", "host-unreachable", "connection-reset-part-way-through"];

// A web socket. It opens and the other end sends no data, until the injector says this one goes
// wrong, and then it fails the way one that cannot reach its server fails.
class RunSocket {
    // What the caller set to hear the socket open.
    onopen: (() => void) | null = null;

    // What it set to hear a message arrive.
    onmessage: ((event: { data: string }) => void) | null = null;

    // What it set to hear the socket fail.
    onerror: (() => void) | null = null;

    // What it set to hear the socket close.
    onclose: (() => void) | null = null;

    // Whether the socket is opening, open or closed, as a page reads it.
    readyState = 0;

    constructor() {
        const failure = nowRunning()?.network.check(socketFailures);
        queueMicrotask(() => {
            if (failure !== undefined && failure !== "connection-reset-part-way-through") {
                this.readyState = 3;
                this.onerror?.();
                this.onclose?.();
                return;
            }
            this.readyState = 1;
            this.onopen?.();
            if (failure === "connection-reset-part-way-through") {
                this.readyState = 3;
                this.onerror?.();
                this.onclose?.();
            }
        });
    }

    send(): void {
        // No data leaves this process, and a caller that sends carries on.
    }

    close(): void {
        this.readyState = 3;
        this.onclose?.();
    }
}

// A store a page keeps things in, held in memory so one run leaves no data behind for the next.
export class RunStorage {
    // Everything this store holds, by key.
    private readonly held = new Map<string, string>();

    // How many keys it holds.
    get length(): number {
        return this.held.size;
    }

    getItem(key: string): string | null {
        return this.held.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.held.set(key, String(value));
    }

    removeItem(key: string): void {
        this.held.delete(key);
    }

    clear(): void {
        this.held.clear();
    }

    key(at: number): string | null {
        return [...this.held.keys()][at] ?? null;
    }
}

// Puts every global back as it was. A test uses it so one run's replacements do not reach the next.
export function removeGlobals(): void {
    for (const held of replaced.reverse()) {
        if (held.was === undefined) {
            delete (held.on as Record<string, unknown>)[held.name];
            continue;
        }
        Object.defineProperty(held.on, held.name, held.was);
    }
    replaced.length = 0;
}
