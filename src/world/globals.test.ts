//
// Checks that the replaced globals answer from the run in flight and from the machine when there is
// none and that putting them back leaves the runtime as it was found.
//
// Each test installs the globals, makes its calls with or without a run in flight and removes the
// globals again in a `finally`. Where a call with no run in flight goes to the machine (the clock,
// the timers, random numbers, `fetch`, the working directory), the machine's own call is replaced
// with `jest.spyOn` before the globals are installed. The test then checks the call is handed on
// with the same arguments and its answer handed back, and no call reaches outside the process.
//

import assert from "node:assert/strict";
import vm from "node:vm";
import { afterEach, describe, jest, test } from "@jest/globals";
import { clockStartMs } from "./clock.ts";
import { runWith, startDriving, stopDriving } from "./current.ts";
import { clearRunTimer, entryCheckName, installClock, installFetch, installGlobals, installRandom, installSending, installWebGlobals, isReadByNode, put, removeGlobals, RunStorage, RunTimer, runTimeoutSignal, setRunTimer, timeoutSignalMsMost } from "./globals.ts";
import type { PlannedFailure } from "./injector.ts";
import { ProcessExitCalled, RunSubject } from "./subject.ts";

//
// Every spy a test set on the machine's own calls is taken away after it, so the next test reaches
// the calls it had.
//
afterEach(() => {
    jest.restoreAllMocks();
});

//
// The arguments a spy was last called with, copied into an array of this realm, because the mock
// keeps them in an array of its own realm and a strict deep comparison checks the prototype. The
// arguments are whatever the spied call takes, so no one type fits them.
//
export function lastCall(spy: jest.Mock): unknown[] {
    return Array.from(spy.mock.lastCall ?? []);
}

//
// A timer's work, which no test runs while the machine's timers are stood in for.
//
export function ignoreTimer(): void {
    return undefined;
}

//
// The most timers one test may run. Every test sets a handful, so a run that reaches this many is
// an interval that never clears itself, and the test fails rather than running forever.
//
export const timerTurnsMax = 1000;

//
// Runs the run's timers in order until none is left, so a test sees what its timers did, and
// returns how many ran.
//
export function runTimers(subject: RunSubject): number {
    for (let turns = 0; turns < timerTurnsMax; turns += 1) {
        if (!subject.clock.runNextTimer()) {
            return turns;
        }
    }
    assert.fail(`The run still had timers after ${timerTurnsMax} of them ran, so an interval never cleared itself.`);
}

//
// One draw from each of the run's random sources (a number, an identifier and a few bytes), so two
// runs of one seed can be compared.
//
export function drawRandom(): IRandomDraw {
    return {
        number: Math.random(),
        identifier: crypto.randomUUID(),
        bytes: [...crypto.getRandomValues(new Uint8Array(4))],
    };
}

//
// What one draw from each of the run's random sources gave.
//
export interface IRandomDraw {
    //
    // What `Math.random` gave.
    //
    number: number;

    //
    // What `crypto.randomUUID` gave.
    //
    identifier: string;

    //
    // What `crypto.getRandomValues` filled a small array with.
    //
    bytes: number[];
}

//
// Stands where the trap on `process.env` does, so the frame below it is the one that made the read.
//
export function readTrap(): boolean {
    return isReadByNode();
}

//
// Waits one turn of the event loop, so a socket's events, which arrive on a later turn as a real
// socket's do, have arrived when the test reads them.
//
export function waitOneTurn(): Promise<void> {
    return new Promise((settle) => {
        setImmediate(settle);
    });
}

//
// Runs `work` with one run in flight and the globals replaced, and puts the runtime back after.
//
export async function whileRunning<Answer>(work: (subject: RunSubject) => Answer | Promise<Answer>, planned: PlannedFailure | undefined): Promise<Answer> {
    installGlobals();
    const subject = new RunSubject(7, planned);
    const before = runWith(subject);
    try {
        return await work(subject);
    }
    finally {
        runWith(before);
        removeGlobals();
    }
}

describe("the clock", () => {
    test("Date.now and a date built with no argument read the run's clock", async () => {
        const seen = await whileRunning(() => [Date.now(), new Date().getTime()], undefined);
        assert.deepEqual(seen, [clockStartMs, clockStartMs + 1]);
    });

    test("a date built with an argument is the date that argument names", async () => {
        assert.equal(await whileRunning(() => new Date(86400000).getTime(), undefined), 86400000);
    });

    test("performance.now reads the run's clock that never goes back", async () => {
        assert.deepEqual(await whileRunning(() => [performance.now(), performance.now()], undefined), [0, 1]);
    });

    test("with no run in flight the clock is the machine's", () => {
        jest.spyOn(Date, "now").mockReturnValue(123);
        jest.spyOn(performance, "now").mockReturnValue(456);
        installGlobals();
        try {
            assert.equal(Date.now(), 123);
            assert.equal(new Date().getTime(), 123);
            assert.equal(performance.now(), 456);
        }
        finally {
            removeGlobals();
        }
    });
});

describe("timers", () => {
    test("a timer set while a run is in flight waits on the run's clock and runs in order of its delay", async () => {
        const ran = await whileRunning((subject) => {
            const order: string[] = [];
            setTimeout(() => order.push("later"), 2000);
            setTimeout((word: string) => order.push(word), 10, "sooner");
            assert.deepEqual(order, []);
            assert.equal(runTimers(subject), 2);
            return order;
        }, undefined);
        assert.deepEqual(ran, ["sooner", "later"]);
    });

    test("a cleared timer and a cleared interval never run", async () => {
        const ran = await whileRunning((subject) => {
            const order: string[] = [];
            const timeout = setTimeout(() => order.push("timeout"), 10);
            const interval = setInterval(() => order.push("interval"), 10);
            clearTimeout(timeout);
            clearInterval(interval);
            assert.equal(runTimers(subject), 0);
            return order;
        }, undefined);
        assert.deepEqual(ran, []);
    });

    test("an interval runs again until it clears itself", async () => {
        const count = await whileRunning((subject) => {
            let turns = 0;
            const interval = setInterval(() => {
                turns += 1;
                if (turns === 3) {
                    clearInterval(interval);
                }
            }, 100);
            assert.equal(runTimers(subject), 3);
            return turns;
        }, undefined);
        assert.equal(count, 3);
    });

    test("a timer's handle has what Node's has", async () => {
        await whileRunning((subject) => {
            const handle = setTimeout(ignoreTimer, 5);
            assert.ok(handle instanceof RunTimer);
            assert.equal(handle.unref().hasRef(), false);
            assert.equal(handle.ref().hasRef(), true);
            assert.equal(handle.refresh(), handle);
            assert.equal(Number(handle), handle.id);
            handle[Symbol.dispose]();
            assert.equal(subject.clock.hasTimers(), false);
        }, undefined);
    });

    test("a timeout signal made while a run is in flight aborts when the run's clock reaches it", async () => {
        await whileRunning((subject) => {
            const signal = AbortSignal.timeout(500);
            assert.equal(signal.aborted, false);
            assert.equal(runTimers(subject), 1);
            assert.equal(signal.aborted, true);
            assert.ok(signal.reason instanceof DOMException);
            assert.equal(signal.reason.name, "TimeoutError");
        }, undefined);
    });

    test("a timeout signal Node would refuse, or one made with no run in flight, is Node's own", async () => {
        assert.equal(runTimeoutSignal(5), undefined);
        await whileRunning((subject) => {
            assert.equal(runTimeoutSignal(0.5), undefined);
            assert.equal(runTimeoutSignal(-1), undefined);
            assert.equal(runTimeoutSignal(timeoutSignalMsMost + 1), undefined);
            assert.equal(runTimeoutSignal("5"), undefined);
            assert.throws(() => AbortSignal.timeout(-1), {
                code: "ERR_OUT_OF_RANGE",
            });
            assert.equal(subject.clock.hasTimers(), false);
        }, undefined);
    });

    test("with no run in flight, or with work that is not a function, a timer is not the run's", () => {
        assert.equal(setRunTimer(() => undefined, 1, [], false), undefined);
        assert.equal(clearRunTimer(1), false);
        //
        // Each spy stands in for a timer call that hands back a Node timer, and the test has it hand
        // back text it can recognise, which only the untyped mock allows, so no guard can stand in
        // for the casts.
        //
        const timeoutSpy = jest.spyOn(globalThis, "setTimeout") as jest.Mock;
        timeoutSpy.mockReturnValue("real setTimeout");
        const intervalSpy = jest.spyOn(globalThis, "setInterval") as jest.Mock;
        intervalSpy.mockReturnValue("real setInterval");
        const clearTimeoutSpy = jest.spyOn(globalThis, "clearTimeout") as jest.Mock;
        clearTimeoutSpy.mockReturnValue(undefined);
        const clearIntervalSpy = jest.spyOn(globalThis, "clearInterval") as jest.Mock;
        clearIntervalSpy.mockReturnValue(undefined);
        installGlobals();
        try {
            const real = setTimeout(ignoreTimer, 1, "a");
            assert.equal(real, "real setTimeout");
            assert.deepEqual(lastCall(timeoutSpy), [ignoreTimer, 1, "a"]);
            clearTimeout(real);
            assert.deepEqual(lastCall(clearTimeoutSpy), ["real setTimeout"]);
            const realInterval = setInterval(ignoreTimer, 2, "b");
            assert.equal(realInterval, "real setInterval");
            assert.deepEqual(lastCall(intervalSpy), [ignoreTimer, 2, "b"]);
            clearInterval(realInterval);
            assert.deepEqual(lastCall(clearIntervalSpy), ["real setInterval"]);
        }
        finally {
            removeGlobals();
        }
    });
});

describe("random numbers", () => {
    test("two runs of one seed draw the same numbers, identifiers and bytes", async () => {
        assert.deepEqual(await whileRunning(drawRandom, undefined), await whileRunning(drawRandom, undefined));
    });

    test("with no run in flight they are the machine's", () => {
        const filled = new Uint8Array(2);
        jest.spyOn(Math, "random").mockReturnValue(0.25);
        jest.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
        //
        // The typed spy of a generic call takes no answer of a type it can check, so the test casts
        // to the untyped mock, which no guard can stand in for.
        //
        const valuesSpy = jest.spyOn(crypto, "getRandomValues") as jest.Mock;
        valuesSpy.mockReturnValue(filled);
        installGlobals();
        try {
            assert.equal(Math.random(), 0.25);
            assert.equal(crypto.randomUUID(), "00000000-0000-4000-8000-000000000000");
            assert.equal(crypto.getRandomValues(filled), filled);
            assert.deepEqual(lastCall(valuesSpy), [filled]);
        }
        finally {
            removeGlobals();
        }
    });
});

describe("fetch", () => {
    test("fetch reaches the run's network", async () => {
        const status = await whileRunning(async () => (await fetch("https://example.com/")).status, {
            place: {
                effect: "network",
                occurrence: 0,
            },
            failure: "server-error",
        });
        assert.equal(status, 500);
    });
});

describe("process", () => {
    test("process.env reads, sets, lists and deletes the run's own environment", async () => {
        const seen = await whileRunning(() => {
            assert.equal(process.env.HOME, undefined);
            process.env.PORT = "8080";
            const read = process.env.PORT;
            const listed = Object.keys(process.env);
            const inside = "PORT" in process.env;
            const spread = {
                ...process.env,
            };
            delete process.env.PORT;
            return [read, listed, inside, spread, "PORT" in process.env];
        }, undefined);
        assert.deepEqual(seen, ["8080", ["PORT"], true, {
            PORT: "8080",
        }, false]);
    });

    test("a read of process.env can be given a variable that is not set", async () => {
        const read = await whileRunning(() => {
            process.env.TOKEN = "secret";
            return process.env.TOKEN;
        }, {
            place: {
                effect: "environment",
                occurrence: 0,
            },
            failure: "variable-not-set",
        });
        assert.equal(read, undefined);
    });

    test("a read of process.env made by Node's own code is the machine's, even with a run in flight", async () => {
        process.env.FAULTLINE_NODE_READ = "machine";
        try {
            const seen = await whileRunning(() => {
                const env = process.env;
                const byNode = vm.runInNewContext("env.FAULTLINE_NODE_READ", {
                    env,
                }, {
                    filename: "node:internal/probe",
                });
                const byCode = vm.runInNewContext("env.FAULTLINE_NODE_READ", {
                    env,
                }, {
                    filename: "/project/src/main.ts",
                });
                return [byNode, byCode];
            }, undefined);
            assert.deepEqual(seen, ["machine", undefined]);
        }
        finally {
            delete process.env.FAULTLINE_NODE_READ;
        }
    });

    test("whether a read was made by Node is told from the frame that made it", () => {
        assert.equal(vm.runInNewContext("readTrap()", {
            readTrap,
        }, {
            filename: "node:internal/probe",
        }), true);
        assert.equal(vm.runInNewContext("readTrap()", {
            readTrap,
        }, {
            filename: "/project/src/main.ts",
        }), false);
    });

    test("with no run in flight process.env is the machine's", () => {
        installGlobals();
        try {
            process.env.FAULTLINE_GLOBALS_TEST = "machine";
            assert.equal(process.env.FAULTLINE_GLOBALS_TEST, "machine");
            assert.equal("FAULTLINE_GLOBALS_TEST" in process.env, true);
            assert.ok(Object.keys(process.env).includes("FAULTLINE_GLOBALS_TEST"));
            assert.equal(Object.getOwnPropertyDescriptor(process.env, "FAULTLINE_GLOBALS_TEST")?.value, "machine");
            delete process.env.FAULTLINE_GLOBALS_TEST;
            assert.equal(process.env.FAULTLINE_GLOBALS_TEST, undefined);
        }
        finally {
            removeGlobals();
        }
    });

    test("standard output, error and input are the run's while it is in flight", async () => {
        const kept = await whileRunning((subject) => {
            process.stdout.write("out");
            process.stderr.write("err");
            assert.equal(process.stdin, subject.stdin);
            return [subject.stdout.written(), subject.stderr.written()];
        }, undefined);
        assert.deepEqual(kept, ["out", "err"]);
    });

    test("console writes to the run's output and error", async () => {
        const kept = await whileRunning((subject) => {
            console.log("hello %s", "there");
            console.warn("careful");
            return [subject.stdout.written(), subject.stderr.written()];
        }, undefined);
        assert.deepEqual(kept, ["hello there\n", "careful\n"]);
    });

    test("the working directory is the run's", async () => {
        const seen = await whileRunning((subject) => {
            subject.files.makeDirectory("/work", false, 0o777);
            const start = process.cwd();
            process.chdir("/work");
            return [start, process.cwd()];
        }, undefined);
        assert.deepEqual(seen, ["/", "/work"]);
    });

    test("with no run in flight the working directory is the machine's", () => {
        jest.spyOn(process, "cwd").mockReturnValue("/machine");
        //
        // `lastCall` reads any spy, so the spy is cast to the untyped mock it takes, which no guard can
        // stand in for.
        //
        const chdirSpy = jest.spyOn(process, "chdir") as jest.Mock;
        chdirSpy.mockReturnValue(undefined);
        installGlobals();
        try {
            assert.equal(process.cwd(), "/machine");
            process.chdir("/elsewhere");
            assert.deepEqual(lastCall(chdirSpy), ["/elsewhere"]);
        }
        finally {
            removeGlobals();
        }
    });

    test("process.exit stops the call where it was called and carries the code", async () => {
        const seen = await whileRunning(() => {
            let after = false;
            let code: number | undefined = undefined;
            try {
                process.exit(4);
                after = true;
            }
            catch (thrown) {
                assert.ok(thrown instanceof ProcessExitCalled);
                code = thrown.exitCode;
            }
            return [after, code];
        }, undefined);
        assert.deepEqual(seen, [false, 4]);
    });

    test("the entry check says a copy of the file the run started is the entry point, and no other file is", async () => {
        const check = (): ((url: string) => boolean) => {
            const found: unknown = Reflect.get(globalThis, entryCheckName);
            assert.ok(typeof found === "function");
            return (url: string): boolean => Reflect.apply(found, undefined, [url]) === true;
        };
        const seen = await whileRunning((subject) => {
            const before = check()("file:///p/src/index.ts?flt=2");
            subject.entryFile = "/p/src/index.ts";
            return [before, check()("file:///p/src/index.ts?flt=2"), check()("file:///p/src/other.ts?flt=2")];
        }, undefined);
        assert.deepEqual(seen, [false, true, false]);
    });

    test("the entry check is taken away with the rest of the globals", () => {
        installGlobals();
        assert.equal(entryCheckName in globalThis, true);
        removeGlobals();
        assert.equal(entryCheckName in globalThis, false);
    });

    test("process.exitCode starts unset in every run, so what one run sets the next does not read", async () => {
        try {
            const first = await whileRunning(() => {
                const before = process.exitCode;
                process.exitCode = 1;
                return [before, process.exitCode];
            }, undefined);
            const second = await whileRunning(() => process.exitCode, undefined);
            assert.deepEqual(first, [undefined, 1]);
            assert.equal(second, undefined);
        }
        finally {
            process.exitCode = undefined;
        }
    });

    test("process.argv belongs to the run: it starts as the real command line and what one run sets the next does not read", async () => {
        const real = [...process.argv];
        const first = await whileRunning(() => {
            const before = [...process.argv];
            process.argv = ["bun", "/p/src/index.ts", "version"];
            return [before, process.argv];
        }, undefined);
        const second = await whileRunning(() => [...process.argv], undefined);
        assert.deepEqual(first, [real, ["bun", "/p/src/index.ts", "version"]]);
        assert.deepEqual(second, real);
        assert.deepEqual([...process.argv], real);
    });

    test("with no run in flight process.argv is the process's own and can be set", () => {
        const real = process.argv;
        installGlobals();
        try {
            assert.equal(process.argv, real);
            process.argv = ["node", "other"];
            assert.deepEqual(process.argv, ["node", "other"]);
        }
        finally {
            removeGlobals();
        }
        assert.equal(process.argv, real);
    });

    test("process.exit with no code ends with the code process.exitCode holds", async () => {
        const seen = await whileRunning(() => {
            process.exitCode = 3;
            let code: number | undefined = undefined;
            try {
                process.exit();
            }
            catch (thrown) {
                assert.ok(thrown instanceof ProcessExitCalled);
                code = thrown.exitCode;
            }
            return code;
        }, undefined);
        process.exitCode = undefined;
        assert.equal(seen, 3);
    });

    test("process.exitCode is never replaced, because Node declares it so that it cannot be", () => {
        const before = process.exitCode;
        const declared = Object.getOwnPropertyDescriptor(process, "exitCode");
        installGlobals();
        try {
            assert.deepEqual(Object.getOwnPropertyDescriptor(process, "exitCode"), declared);
            process.exitCode = 5;
            assert.equal(process.exitCode, 5);
        }
        finally {
            process.exitCode = before;
            removeGlobals();
        }
        assert.equal(process.exitCode, before);
    });

    test("while the driving is on, the code under test sends nothing to the process that started it", () => {
        const sent: string[] = [];
        const held = Object.getOwnPropertyDescriptor(process, "send");
        process.send = (message: string): boolean => {
            sent.push(message);
            return true;
        };
        installGlobals();
        try {
            startDriving();
            assert.equal(process.send("made up"), true);
            stopDriving();
            process.send("the tool's own");
        }
        finally {
            stopDriving();
            removeGlobals();
            if (held === undefined) {
                delete process.send;
            }
            else {
                Object.defineProperty(process, "send", held);
            }
        }
        assert.deepEqual(sent, ["the tool's own"]);
    });
});

describe("the web globals", () => {
    test("a socket opens and the other end sends no data", async () => {
        const events = await whileRunning(async () => {
            const heard: string[] = [];
            const socket = new WebSocket("wss://example.com/");
            socket.onopen = () => heard.push("open");
            socket.onmessage = () => heard.push("message");
            await waitOneTurn();
            socket.send("x");
            socket.close();
            return [heard, socket.readyState];
        }, undefined);
        assert.deepEqual(events, [["open"], 3]);
    });

    test("a socket that cannot connect fails and closes", async () => {
        const events = await whileRunning(async () => {
            const heard: string[] = [];
            const socket = new WebSocket("wss://example.com/");
            socket.onerror = () => heard.push("error");
            socket.onclose = () => heard.push("close");
            await waitOneTurn();
            return heard;
        }, {
            place: {
                effect: "network",
                occurrence: 0,
            },
            failure: "connection-refused",
        });
        assert.deepEqual(events, ["error", "close"]);
    });

    test("a socket reset part way through opens, then fails and closes", async () => {
        const events = await whileRunning(async () => {
            const heard: string[] = [];
            const socket = new WebSocket("wss://example.com/");
            socket.onopen = () => heard.push("open");
            socket.onerror = () => heard.push("error");
            socket.onclose = () => heard.push("close");
            await waitOneTurn();
            return heard;
        }, {
            place: {
                effect: "network",
                occurrence: 0,
            },
            failure: "connection-reset-part-way-through",
        });
        assert.deepEqual(events, ["open", "error", "close"]);
    });
});

describe("putting the globals back", () => {
    test("replacing twice replaces nothing the second time, and removing puts back what was there", () => {
        const before = Date;
        installGlobals();
        const replaced = Date;
        installGlobals();
        assert.equal(Date, replaced);
        removeGlobals();
        assert.equal(Date, before);
        assert.notEqual(replaced, before);
    });
});

describe("what is replaced and how", () => {
    test("a name the target does not have is not added, and one it will not let go of is kept", () => {
        const target: Record<string, number> = {};
        put(target, "missing", 1);
        assert.equal("missing" in target, false);
        const fixed = Object.freeze({
            kept: 1,
        });
        put(fixed, "kept", 2);
        assert.equal(fixed.kept, 1);
        removeGlobals();
    });

    test("a runtime with no fetch, no channel to its parent and no stores is left alone", () => {
        const bare: Record<string, number> = {};
        installFetch(bare);
        //
        // The point is a process with no channel to its parent, which no real `process` is, so no
        // guard can produce one and the test has to cast.
        //
        installSending(bare as unknown as NodeJS.Process);
        installWebGlobals(bare);
        assert.deepEqual(bare, {});
    });

    test("a runtime with stores gets stores held in memory", () => {
        const withStores: Record<string, object> = {
            localStorage: {},
            sessionStorage: {},
        };
        installWebGlobals(withStores);
        try {
            assert.ok(withStores.localStorage instanceof RunStorage);
            assert.ok(withStores.sessionStorage instanceof RunStorage);
        }
        finally {
            removeGlobals();
        }
    });

    test("a store keeps what is set in it as text, by key", () => {
        const store = new RunStorage();
        //
        // The point is a value that is not text, which the type rules out, so no guard can produce
        // one and the test has to cast.
        //
        store.setItem("a", 1 as unknown as string);
        store.setItem("b", "two");
        assert.equal(store.length, 2);
        assert.equal(store.getItem("a"), "1");
        assert.equal(store.getItem("missing"), null);
        assert.equal(store.key(1), "b");
        assert.equal(store.key(5), null);
        store.removeItem("a");
        assert.equal(store.length, 1);
        store.clear();
        assert.equal(store.length, 0);
    });

    test("with no run in flight fetch and console are the real ones", async () => {
        const answer = new Response("machine");
        //
        // `lastCall` reads any spy, so each spy is cast to the untyped mock it takes, which no guard
        // can stand in for.
        //
        const fetchSpy = jest.spyOn(globalThis, "fetch") as jest.Mock;
        fetchSpy.mockReturnValue(Promise.resolve(answer));
        const logSpy = jest.spyOn(console, "log") as jest.Mock;
        logSpy.mockReturnValue(undefined);
        installGlobals();
        try {
            const init = {
                method: "POST",
            };
            assert.equal(await fetch("https://example.com/", init), answer);
            assert.deepEqual(lastCall(fetchSpy), ["https://example.com/", init]);
            console.log("machine");
            assert.deepEqual(lastCall(logSpy), ["machine"]);
        }
        finally {
            removeGlobals();
        }
    });

    test("a runtime with no performance clock and no web crypto keeps the clock and random calls it has", () => {
        const bare: Record<string, DateConstructor> = {
            Date,
        };
        installClock(bare);
        installRandom(bare);
        try {
            assert.notEqual(bare.Date, Date);
            assert.equal("performance" in bare, false);
            assert.equal("crypto" in bare, false);
        }
        finally {
            removeGlobals();
        }
    });

    test("with no run in flight the standard streams are the machine's", () => {
        const streams = [process.stdin, process.stdout, process.stderr];
        installGlobals();
        try {
            assert.deepEqual([process.stdin, process.stdout, process.stderr], streams);
        }
        finally {
            removeGlobals();
        }
    });

    test("with no run in flight process.exit is the real one", () => {
        const held = Object.getOwnPropertyDescriptor(process, "exit");
        assert(held);
        const asked: number[] = [];
        Object.defineProperty(process, "exit", {
            ...held,
            value: (code: number) => {
                asked.push(code);
            },
        });
        installGlobals();
        try {
            process.exit(2);
        }
        finally {
            removeGlobals();
            Object.defineProperty(process, "exit", held);
        }
        assert.deepEqual(asked, [2]);
    });

    test("process.env answers a symbol, and a variable that is not set has no property, while a run is in flight", async () => {
        const seen = await whileRunning(() => {
            const tag = Reflect.get(process.env, Symbol.toStringTag);
            const described = Object.getOwnPropertyDescriptor(process.env, "MISSING");
            const symbolDescribed = Object.getOwnPropertyDescriptor(process.env, Symbol.toStringTag);
            assert.equal(Reflect.set(process.env, Symbol.for("faultline"), 1), true);
            const hasSymbol = Symbol.for("faultline") in process.env;
            assert.equal(Reflect.deleteProperty(process.env, Symbol.for("faultline")), true);
            return [tag, described, symbolDescribed, hasSymbol];
        }, undefined);
        assert.deepEqual(seen, [undefined, undefined, undefined, true]);
    });
});
