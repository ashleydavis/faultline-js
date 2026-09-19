// Scenarios for the globals a run replaces.
//
// Whether a run is in flight is not an argument, so no made up call reaches these at all.
//
// Both sides are here. The side with no run in flight answers with the machine's own clock and
// network, and what that comes to while a run is measuring this very file is whatever the run
// itself was given: the machine's clock is held from before the copy replaced it, and the copy was
// loaded by a run that had already replaced it once. So what is checked there is that each answers
// at all, rather than what it answers with.

import type { Checklist, Injector } from "faultline";
import { runWith } from "./current.ts";
import { installGlobals, realNow, removeGlobals } from "./globals.ts";
import { RunSubject } from "./subject.ts";

// Runs `work` with the globals replaced and one run in flight, then puts the runtime back.
async function replaced(work: () => Promise<void> | void): Promise<void> {
    installGlobals();
    const held = runWith(new RunSubject(11, "clean"));
    try {
        await work();
    }
    finally {
        runWith(held);
        removeGlobals();
    }
}

// Every replaced global read with a run in flight, which is what the code under test sees.
export async function everyGlobalWithARunInFlight(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    await replaced(async () => {
        if (Date.now() !== 1704067200000) {
            throw new Error("TheClockWasNotTheRunsOwn");
        }
        if (new Date().getTime() !== 1704067200000) {
            throw new Error("ADateBuiltWithNoArgumentWasNotTheRunsOwn");
        }
        if (new Date(86400000).getTime() !== 86400000) {
            throw new Error("ADateBuiltWithAnArgumentWasNotThatDate");
        }
        if (typeof Math.random() !== "number") {
            throw new Error("TheRandomnessWasNotANumber");
        }
        if (typeof performance.now() !== "number") {
            throw new Error("TheMonotonicClockWasNotANumber");
        }
        if (crypto.randomUUID().length !== 36) {
            throw new Error("TheIdentifierWasNotAUuid");
        }
        crypto.getRandomValues(new Uint8Array(8));
        if (!((await fetch("https://example.com/")) instanceof Response)) {
            throw new Error("TheNetworkWasNotTheRunsOwn");
        }
    });
}

// Every replaced global read with no run in flight.
//
// Nothing puts one there: this file's own copy holds the run, and until something sets it the
// replacements fall through to what they were given.
export async function everyGlobalWithNoRunInFlight(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    installGlobals();
    try {
        if (typeof Date.now() !== "number") {
            throw new Error("TheClockDidNotAnswerWithANumber");
        }
        if (typeof new Date().getTime() !== "number") {
            throw new Error("ADateBuiltWithNoArgumentDidNotAnswer");
        }
        if (new Date(86400000).getTime() !== 86400000) {
            throw new Error("ADateBuiltWithAnArgumentWasNotThatDate");
        }
        if (typeof Math.random() !== "number") {
            throw new Error("TheRandomnessDidNotAnswerWithANumber");
        }
        if (typeof performance.now() !== "number") {
            throw new Error("TheMonotonicClockDidNotAnswerWithANumber");
        }
        if (crypto.randomUUID().length !== 36) {
            throw new Error("TheIdentifierWasNotAUuid");
        }
        if (crypto.getRandomValues(new Uint8Array(8)).length !== 8) {
            throw new Error("TheBytesWereNotHandedBack");
        }
        if (!((await fetch("https://example.com/")) instanceof Response)) {
            throw new Error("TheNetworkDidNotAnswer");
        }
        await new Promise<void>((settle) => {
            const held = setTimeout(settle, 1);
            clearTimeout(held);
            settle();
        });
        const every = setInterval(() => undefined, 1);
        clearInterval(every);
    }
    finally {
        removeGlobals();
    }
}

// A call that waits costs the run no time and moves its clock forward instead.
export async function aCallThatWaitsCostsNoTime(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    await replaced(async () => {
        const before = Date.now();
        const started = realNow();
        await new Promise<void>((settle) => setTimeout(settle, 3600000));
        if (Date.now() - before !== 3600000) {
            throw new Error("TheClockDidNotMoveForwardByWhatWasWaitedFor");
        }
        if (realNow() - started > 1000) {
            throw new Error("TheRunActuallyWaited");
        }
    });
}

// A repeating timer runs one turn, so the run gets past it.
export async function aRepeatingTimerRunsOneTurn(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    await replaced(async () => {
        let turns = 0;
        const every = setInterval(() => {
            turns += 1;
        }, 10) as { ref: () => void; unref: () => void };
        // A caller that says whether the timer keeps the runtime awake, which a run's own does not.
        every.ref();
        every.unref();
        const once = setTimeout(() => undefined, 10) as unknown as { ref: () => void; unref: () => void };
        once.ref();
        once.unref();
        clearInterval(0 as unknown as ReturnType<typeof setInterval>);
        clearTimeout(0 as unknown as ReturnType<typeof setTimeout>);
        await new Promise<void>((settle) => queueMicrotask(() => queueMicrotask(settle)));
        if (turns !== 1) {
            throw new Error("TheRepeatingTimerDidNotRunOneTurn");
        }
    });
}

// Replacing the globals twice replaces nothing the second time, and putting them back leaves the
// runtime as it was found.
export function replacingTwiceReplacesNothingTheSecondTime(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    installGlobals();
    const once = Date.now;
    installGlobals();
    if (Date.now !== once) {
        throw new Error("TheSecondReplacingChangedSomething");
    }
    removeGlobals();
    if (Date.now === once) {
        throw new Error("PuttingThemBackLeftTheReplacement");
    }
}

// The stores a page keeps things in, which a run owns and which throw when the run says the store
// is full.
export function theStoresAPageKeepsThingsIn(injector: Injector, checklist: Checklist): void {
    void checklist;

    const global = globalThis as unknown as Record<string, unknown>;
    const already = Object.getOwnPropertyDescriptor(global, "localStorage");
    Object.defineProperty(global, "localStorage", { value: { getItem: () => null }, configurable: true });
    installGlobals();
    const subject = new RunSubject(11, "clean");
    const held = runWith(subject);
    try {
        const store = global.localStorage as Storage;
        store.setItem("a", "b");
        if (store.getItem("a") !== "b") {
            throw new Error("TheStoreDidNotKeepWhatItWasGiven");
        }
        if (store.length !== 1) {
            throw new Error("TheStoreDidNotSayHowMuchItHeld");
        }
        if (store.key(0) !== "a") {
            throw new Error("TheStoreDidNotNameWhatItHeld");
        }
        store.removeItem("a");
        store.setItem("c", "d");
        store.clear();
        if (store.getItem("c") !== null) {
            throw new Error("TheStoreKeptSomethingAfterItWasCleared");
        }
        subject.injector.fail("files", "full");
        let refused = false;
        try {
            store.setItem("e", "f");
        }
        catch {
            refused = true;
        }
        if (!refused) {
            throw new Error("TheFullStoreTookWhatItWasGiven");
        }
    }
    finally {
        runWith(held);
        removeGlobals();
        if (already === undefined) {
            delete global.localStorage;
        }
        else {
            Object.defineProperty(global, "localStorage", already);
        }
    }
}

// The older way of fetching and the socket a page opens, neither of which a run in Node reaches
// because the runtime has neither of them to replace.
export async function theWaysAPageReachesTheNetwork(injector: Injector, checklist: Checklist): Promise<void> {
    void checklist;

    const global = globalThis as unknown as Record<string, unknown>;
    const heldXhr = Object.getOwnPropertyDescriptor(global, "XMLHttpRequest");
    const heldSocket = Object.getOwnPropertyDescriptor(global, "WebSocket");
    // The runtime is given both, so replacing them is something the run does rather than steps over.
    Object.defineProperty(global, "XMLHttpRequest", { value: class {}, configurable: true });
    Object.defineProperty(global, "WebSocket", { value: class {}, configurable: true });
    installGlobals();
    const subject = new RunSubject(11, "clean");
    const held = runWith(subject);
    try {
        await askedFor(global, "https://example.com/");
        // A request that will not reach its server, so what a caller listening for that is told.
        subject.injector.fail("net", "refused");
        subject.injector.fail("net", "refused");
        subject.injector.fail("net", "refused");
        await askedFor(global, "https://example.com/");
        await opened(global);
        subject.injector.fail("net", "refused");
        await opened(global);
        subject.injector.fail("net", "bad-body");
        await opened(global);
    }
    finally {
        runWith(held);
        removeGlobals();
        put(global, "XMLHttpRequest", heldXhr);
        put(global, "WebSocket", heldSocket);
    }
}

// One request made the older way, answered through every way a caller listens for it.
async function askedFor(global: Record<string, unknown>, url: string): Promise<void> {
    const Held = global.XMLHttpRequest as new () => {
        open: (method: string, at: string) => void;
        setRequestHeader: (name: string, value: string) => void;
        addEventListener: (name: string, handler: () => void) => void;
        send: () => void;
        abort: () => void;
        onload: (() => void) | null;
        onerror: (() => void) | null;
        onreadystatechange: (() => void) | null;
        responseText: string;
        readyState: number;
    };
    await new Promise<void>((settle) => {
        const asked = new Held();
        asked.open("GET", url);
        asked.setRequestHeader("accept", "application/json");
        // Two handlers for one thing, so the second is added to the first rather than replacing it.
        asked.addEventListener("load", () => undefined);
        asked.addEventListener("load", () => undefined);
        asked.addEventListener("error", () => undefined);
        asked.addEventListener("error", () => undefined);
        asked.onreadystatechange = () => undefined;
        asked.onerror = () => settle();
        asked.onload = () => settle();
        asked.send();
    });
    // A caller that listens the older way and adds no handler at all, so there is no list of them
    // to walk. Both ways the request can go, because each walks a list of its own.
    for (let at = 0; at < 2; at += 1) {
        await new Promise<void>((settle) => {
            const bare = new Held();
            bare.open("GET", url);
            bare.onload = () => settle();
            bare.onerror = () => settle();
            bare.send();
        });
    }

    const other = new Held();
    other.open("GET", url);
    other.abort();
    // Sending with no run in flight leaves it where it is, which is the case the tool's own reads
    // take. It cannot be reached from here, so it is only the abort above that is checked.
}

// One socket opened, however the injector says it goes.
async function opened(global: Record<string, unknown>): Promise<void> {
    const Held = global.WebSocket as new (url: string) => {
        onopen: (() => void) | null;
        onmessage: ((event: { data: string }) => void) | null;
        onerror: (() => void) | null;
        onclose: (() => void) | null;
        send: (text: string) => void;
        close: () => void;
        readyState: number;
    };
    await new Promise<void>((settle) => {
        const socket = new Held("wss://example.com/");
        socket.onopen = () => socket.send("hello");
        socket.onmessage = () => {
            socket.close();
            settle();
        };
        socket.onerror = () => undefined;
        socket.onclose = () => settle();
    });
}

// Puts one global back the way it was found.
function put(global: Record<string, unknown>, name: string, was: PropertyDescriptor | undefined): void {
    if (was === undefined) {
        delete global[name];
        return;
    }
    Object.defineProperty(global, name, was);
}

// A runtime missing each of the globals a run would replace.
//
// Node has no XMLHttpRequest and a browser has no process, so what is there differs, and a name the
// runtime does not have is left alone rather than added: code that checks for a global before using
// it would otherwise take a path the real runtime never gives it.
export function aRuntimeMissingEachGlobal(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const global = globalThis as unknown as Record<string, unknown>;
    for (const name of ["fetch", "performance", "crypto"]) {
        const was = Object.getOwnPropertyDescriptor(global, name);
        delete global[name];
        try {
            installGlobals();
            removeGlobals();
        }
        finally {
            if (was !== undefined) {
                Object.defineProperty(global, name, was);
            }
        }
    }

    // A runtime whose clock and randomness sit on a prototype rather than on the thing itself, so
    // there is no description of them to put back.
    const onAPrototype = Object.create({ now: () => 1 }) as { now: () => number };
    const heldPerformance = Object.getOwnPropertyDescriptor(global, "performance");
    Object.defineProperty(global, "performance", { value: onAPrototype, configurable: true });
    try {
        installGlobals();
        performance.now();
        removeGlobals();
    }
    finally {
        if (heldPerformance === undefined) {
            delete global.performance;
        }
        else {
            Object.defineProperty(global, "performance", heldPerformance);
        }
    }

    // A runtime that will not let one of its own globals be replaced keeps it, and everything else
    // is still replaced.
    const refuses = Object.freeze({ now: () => 1 });
    const alsoHeld = Object.getOwnPropertyDescriptor(global, "performance");
    Object.defineProperty(global, "performance", { value: refuses, configurable: true });
    try {
        installGlobals();
        removeGlobals();
    }
    finally {
        if (alsoHeld === undefined) {
            delete global.performance;
        }
        else {
            Object.defineProperty(global, "performance", alsoHeld);
        }
    }
}

// The older way of fetching, used with no run in flight, which reaches nothing and answers nothing.
export function theOlderWayOfFetchingWithNoRun(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const global = globalThis as unknown as Record<string, unknown>;
    const held = Object.getOwnPropertyDescriptor(global, "XMLHttpRequest");
    Object.defineProperty(global, "XMLHttpRequest", { value: class {}, configurable: true });
    installGlobals();
    try {
        const Held = global.XMLHttpRequest as new () => { open: (a: string, b: string) => void; send: () => void; readyState: number };
        const asked = new Held();
        asked.open("GET", "https://example.com/");
        asked.send();
        if (asked.readyState !== 1) {
            throw new Error("TheRequestWentSomewhereWithNoRunInFlight");
        }
    }
    finally {
        removeGlobals();
        if (held === undefined) {
            delete global.XMLHttpRequest;
        }
        else {
            Object.defineProperty(global, "XMLHttpRequest", held);
        }
    }
}
