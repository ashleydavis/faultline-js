// The globals a run replaces, so code that reads the clock, draws a random number or fetches over
// the network is exercised without declaring anything.
//
// Every replacement asks for the run in flight. When there is none the real one is called, so the
// tool's own clock and network are its own and a project loaded but not yet driven behaves.
//
// Nothing here is Node's or a browser's alone. A global a runtime does not have is left alone.

import { nowRunning } from "./current.ts";

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
    on: Record<string, unknown>;

    // What it was called.
    name: string;

    // How it was declared, so putting it back leaves the runtime as it was found.
    was?: PropertyDescriptor;
}

// Everything this process replaced, newest first, so putting it back is walking the list.
const replaced: Held[] = [];

// Puts `value` in place of `on[name]`, remembering how it was declared. A name the runtime does not
// have is left alone rather than added, because code that checks for a global before using it would
// otherwise take a path the real runtime never gives it.
//
// It is defined rather than assigned, because a browser declares `localStorage` and the rest with a
// getter and no setter, and assigning to one of those changes nothing.
function put(on: Record<string, unknown>, name: string, value: unknown): void {
    if (!(name in on)) {
        return;
    }
    const was = Object.getOwnPropertyDescriptor(on, name);
    try {
        Object.defineProperty(on, name, { value, writable: true, configurable: true, enumerable: was?.enumerable ?? false });
    }
    catch {
        // A runtime that will not let one of its own globals be replaced keeps it, and the code
        // under test reaches the real one. Everything else is still replaced.
        return;
    }
    replaced.push({ on, name, was });
}

// Replaces every global a run controls. Calling it twice replaces nothing the second time.
export function installGlobals(): void {
    if (replaced.length > 0) {
        return;
    }
    const global = globalThis as unknown as Record<string, unknown>;
    const realDate = Date;
    const realRandom = Math.random.bind(Math);
    const realFetch = typeof global.fetch === "function" ? (global.fetch as typeof fetch).bind(global) : undefined;

    // A clock the code under test reads through `new Date()` and `Date.now()`. Everything else a
    // date does is the real thing, so parsing, formatting and arithmetic are unchanged.
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
    put(Math as unknown as Record<string, unknown>, "random", (): number => nowRunning()?.rng.next() ?? realRandom());

    if (realFetch !== undefined) {
        put(global, "fetch", (input: string | URL, init?: RequestInit): Promise<Response> => {
            const running = nowRunning();
            if (running === undefined) {
                return realFetch(input, init);
            }
            return running.net.fetch(input, init);
        });
    }

    const performanceOf = global.performance as { now?: () => number } | undefined;
    if (performanceOf?.now !== undefined) {
        const realNow = performanceOf.now.bind(performanceOf);
        put(performanceOf as unknown as Record<string, unknown>, "now", (): number => nowRunning()?.clock.monotonic() ?? realNow());
    }

    installTimers(global);
    installBrowser(global);

    const cryptoOf = global.crypto as { randomUUID?: () => string; getRandomValues?: (into: Uint8Array) => Uint8Array } | undefined;
    if (cryptoOf?.randomUUID !== undefined) {
        const realUuid = cryptoOf.randomUUID.bind(cryptoOf);
        put(cryptoOf as unknown as Record<string, unknown>, "randomUUID", (): string => nowRunning()?.rng.uuid() ?? realUuid());
    }
    if (cryptoOf?.getRandomValues !== undefined) {
        const realValues = cryptoOf.getRandomValues.bind(cryptoOf);
        put(cryptoOf as unknown as Record<string, unknown>, "getRandomValues", (into: Uint8Array): Uint8Array => {
            const running = nowRunning();
            if (running === undefined) {
                return realValues(into);
            }
            into.set(running.rng.bytes(into.length));
            return into;
        });
    }
}

// Replaces the timers, so a call that waits costs a run no time at all.
//
// A run exercises a function hundreds of times, and code that sleeps for a second would make the
// run take hours. The work is done at once and the run's own clock is moved forward instead, so
// code that reads the time after waiting reads a time that has moved.
//
// A timer set when no run is in flight is the real one, so the tool's own waiting still waits.
function installTimers(global: Record<string, unknown>): void {
    const realSetTimeout = global.setTimeout as (work: () => void, after?: number, ...args: unknown[]) => unknown;
    const realSetInterval = global.setInterval as (work: () => void, every?: number, ...args: unknown[]) => unknown;

    put(global, "setTimeout", (work: () => void, after = 0, ...args: unknown[]): unknown => {
        const running = nowRunning();
        if (running === undefined || typeof work !== "function") {
            return realSetTimeout(work, after, ...args);
        }
        void running.clock.sleep(after);
        queueMicrotask(() => work(...(args as [])));
        return { unref: () => undefined, ref: () => undefined };
    });

    put(global, "setInterval", (work: () => void, every = 0, ...args: unknown[]): unknown => {
        const running = nowRunning();
        if (running === undefined || typeof work !== "function") {
            return realSetInterval(work, every, ...args);
        }
        // One turn only. A repeating timer that kept firing would never let the run get past it,
        // and the code inside it is reached by the one turn.
        void running.clock.sleep(every);
        queueMicrotask(() => work(...(args as [])));
        return { unref: () => undefined, ref: () => undefined };
    });

    // Clearing a timer that already ran is what the runtime allows, so both take anything and do
    // nothing with it.
    put(global, "clearTimeout", (): undefined => undefined);
    put(global, "clearInterval", (): undefined => undefined);
}

// Replaces what only a browser has: the older way of fetching, the socket, the two stores and the
// database. A runtime without them is left alone.
function installBrowser(global: Record<string, unknown>): void {
    if (typeof global.XMLHttpRequest === "function") {
        put(global, "XMLHttpRequest", RunXhr);
    }
    if (typeof global.WebSocket === "function") {
        put(global, "WebSocket", RunSocket);
    }
    for (const name of ["localStorage", "sessionStorage"]) {
        if (global[name] !== undefined) {
            put(global, name, new RunStorage());
        }
    }
}

// The older way of fetching, as a page still uses it. It answers the way the run's own network
// answers, so one injected failure reaches code written either way.
class RunXhr {
    // What the caller is waiting on, so the answer goes back to it.
    private handlers = new Map<string, ((event: unknown) => void)[]>();

    // Where the request was aimed.
    private where = "";

    // The status the answer came back with.
    status = 0;

    // The body it came back with.
    responseText = "";

    // How far through the request is, as a page reads it.
    readyState = 0;

    // What the caller set to hear the request finish.
    onload: (() => void) | null = null;

    // What it set to hear the request fail.
    onerror: (() => void) | null = null;

    // What it set to hear either.
    onreadystatechange: (() => void) | null = null;

    open(_method: string, url: string): void {
        this.where = url;
        this.readyState = 1;
    }

    setRequestHeader(): void {
        // A header changes nothing about what this answers, and a caller that sets one carries on.
    }

    addEventListener(name: string, handler: (event: unknown) => void): void {
        this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }

    send(): void {
        const running = nowRunning();
        if (running === undefined) {
            return;
        }
        void running.net
            .fetch(this.where)
            .then(async (answer) => {
                this.status = answer.status;
                this.responseText = await answer.text();
                this.readyState = 4;
                this.onreadystatechange?.();
                this.onload?.();
                for (const handler of this.handlers.get("load") ?? []) {
                    handler({});
                }
            })
            .catch(() => {
                this.status = 0;
                this.readyState = 4;
                this.onreadystatechange?.();
                this.onerror?.();
                for (const handler of this.handlers.get("error") ?? []) {
                    handler({});
                }
            });
    }

    abort(): void {
        this.readyState = 0;
    }
}

// A socket a page opens. It opens until the injector says this one goes wrong, and then it fails
// the way one that cannot reach its server fails.
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
        const failure = nowRunning()?.injector.check("net");
        queueMicrotask(() => {
            if (failure === "refused" || failure === "timeout" || failure === "dns") {
                this.readyState = 3;
                this.onerror?.();
                this.onclose?.();
                return;
            }
            this.readyState = 1;
            this.onopen?.();
            this.onmessage?.({ data: failure === "bad-body" ? "<not json>" : '{"ok":true}' });
        });
    }

    send(): void {
        // Nothing leaves this process, and a caller that sends carries on.
    }

    close(): void {
        this.readyState = 3;
        this.onclose?.();
    }
}

// A store a page keeps things in, held in memory so one run leaves nothing behind for the next.
class RunStorage {
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
        // A store that is full is what a page hits and rarely handles, so it is one of the ways the
        // run breaks this one.
        const failure = nowRunning()?.injector.check("files");
        if (failure === "full" || failure === "denied") {
            const thrown = new Error(`Failed to execute 'setItem' on 'Storage': the quota has been exceeded.`);
            thrown.name = "QuotaExceededError";
            throw thrown;
        }
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
            delete held.on[held.name];
            continue;
        }
        Object.defineProperty(held.on, held.name, held.was);
    }
    replaced.length = 0;
}
