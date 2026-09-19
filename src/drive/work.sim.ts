// Scenarios for the driving itself.
//
// What the driving does turns on the run it is given: which unit, which function, what that
// function does when it is called. No made up value builds a run, so these build one.

import type { Checklist, Injector } from "faultline";
import type { FileModel, RunModel } from "../model.ts";
import type { ClassInfo, FunctionInfo } from "../discover/functions.ts";
import type { FromDriver, Unit } from "./protocol.ts";
import { readFactories, runUnit, type Runtime } from "./work.ts";
import type { CallableFactory } from "./values.ts";

// What the module the driving loads hands out. Every one of these is something a function under
// test does, and the driving has something to say about each.
const held = {
    plain: (a: string): string => a,
    waits: async (a: number): Promise<number> => a,
    throws: (): never => {
        throw new Error("ThisIsWhatCodeUnderTestDoes");
    },
    rejects: async (): Promise<never> => {
        throw new Error("ThisIsWhatCodeUnderTestDoes");
    },
    handsBackAFunction: () => () => 1,
    handsBackAnObject: () => ({ held: () => 1, also: 2 }),
    handsBackAList: () => [1, 2],
    Made: class Made {
        private kept = 0;

        constructor(at: number) {
            this.kept = at;
        }

        method(a: string): string {
            return a;
        }

        static onTheClass(): number {
            return 1;
        }

        get read(): number {
            return this.kept;
        }

        set read(at: number) {
            this.kept = at;
        }

        refuses(): never {
            throw new Error("ThisIsWhatCodeUnderTestDoes");
        }
    },
    Refuses: class Refuses {
        constructor() {
            throw new Error("ThisConstructorRefusesWhatItWasGiven");
        }
    },
    aScenario: (one: Injector, two: Checklist): void => {
        one.failures("files");
        two.ticked("a");
    },
    aFailingScenario: (): void => {
        throw new Error("TheAnswerWasWrong");
    },
    anInvariant: (): void => undefined,
    aBrokenInvariant: (): void => {
        throw new Error("TheInvariantStoppedHolding");
    },
    aFactory: (): { name: string } => ({ name: "a" }),
};

// One function of the model, written the way the reading of a project writes it.
function fn(label: string, reach: FunctionInfo["reach"], parameters: FunctionInfo["parameters"] = []): FunctionInfo {
    return { label, file: "held.ts", line: 1, async: false, parameters, reach };
}

// The one class of the model.
const classes: ClassInfo[] = [
    { name: "Made", exportName: "Made", file: "held.ts", parameters: [{ name: "at", optional: false, rest: false, recipe: { kind: "number" } }], key: "held.ts#Made" },
    { name: "Refuses", exportName: "Refuses", file: "held.ts", parameters: [], key: "held.ts#Refuses" },
];

// Every function the driving is asked to call.
const functions: FunctionInfo[] = [
    fn("plain", { how: "export", name: "plain" }, [{ name: "a", optional: false, rest: false, recipe: { kind: "string" } }]),
    fn("waits", { how: "export", name: "waits" }, [{ name: "a", optional: true, rest: false, recipe: { kind: "number" } }]),
    fn("throws", { how: "export", name: "throws" }),
    fn("rejects", { how: "export", name: "rejects" }),
    fn("handsBackAFunction", { how: "export", name: "handsBackAFunction" }),
    fn("handsBackAnObject", { how: "export", name: "handsBackAnObject" }),
    fn("handsBackAList", { how: "export", name: "handsBackAList" }),
    fn("needsSomething", { how: "export", name: "plain" }, [{ name: "a", optional: false, rest: false, recipe: { kind: "unknown", text: "symbol" } }]),
    fn("takesTheRest", { how: "export", name: "plain" }, [{ name: "a", optional: false, rest: true, recipe: { kind: "string" } }]),
    fn("notThere", { how: "export", name: "notThereAtAll" }),
    fn("Made.method", { how: "method", className: "Made", classExport: "Made", name: "method", onClass: false, accessor: "none" }, [{ name: "a", optional: false, rest: false, recipe: { kind: "string" } }]),
    fn("Made.onTheClass", { how: "method", className: "Made", classExport: "Made", name: "onTheClass", onClass: true, accessor: "none" }),
    fn("Made.read", { how: "method", className: "Made", classExport: "Made", name: "read", onClass: false, accessor: "get" }),
    fn("Made.write", { how: "method", className: "Made", classExport: "Made", name: "read", onClass: false, accessor: "set" }, [{ name: "at", optional: false, rest: false, recipe: { kind: "number" } }]),
    fn("Made.refuses", { how: "method", className: "Made", classExport: "Made", name: "refuses", onClass: false, accessor: "none" }),
    fn("Made.missing", { how: "method", className: "Made", classExport: "Made", name: "notThereAtAll", onClass: false, accessor: "none" }),
    fn("Refuses.method", { how: "method", className: "Refuses", classExport: "Refuses", name: "method", onClass: false, accessor: "none" }),
    fn("NotExported.method", { how: "method", className: "NotExported", classExport: "", name: "method", onClass: false, accessor: "none" }),
    fn("NotThere.method", { how: "method", className: "NotThere", classExport: "notThereAtAll", name: "method", onClass: false, accessor: "none" }),
];

// The file those functions are in, with a path per function so a unit has something to be after.
const file: FileModel = {
    file: "held.ts",
    module: "held.mjs",
    functions,
    classes,
    paths: functions.map((one, at) => ({
        name: `${one.label}:entered`,
        describe: `the body of ${one.label}`,
        file: "held.ts",
        line: at + 1,
        fn: one.label,
        at: { line: at + 1, column: 0 },
    })),
    tests: ["kept", 7],
    properties: ["name"],
};

// The whole run.
const model: RunModel = {
    root: "/root",
    work: "/work",
    files: [file],
    factories: [{ key: "held.ts#Held", typeName: "Held", file: "held.sim.ts", exportName: "aFactory", parameters: [] }],
    scenarios: [
        { file: "held.sim.ts", exportName: "aScenario", line: 1, module: "held.sim.mjs" },
        { file: "held.sim.ts", exportName: "aFailingScenario", line: 2, module: "held.sim.mjs" },
        { file: "held.sim.ts", exportName: "notThereAtAll", line: 3, module: "held.sim.mjs" },
    ],
    invariants: [{ file: "held.sim.ts", exportName: "anInvariant", line: 4, module: "held.sim.mjs" }],
    simModules: { "held.sim.ts": "held.sim.mjs" },
    unseen: [],
    seeds: [1],
    callBudget: 1000,
};

// A runtime that loads the module above and keeps what the driving said.
function runtimeFor(reached?: () => Promise<Set<string>>): { runtime: Runtime; said: FromDriver[] } {
    const said: FromDriver[] = [];
    return {
        said,
        runtime: {
            load: async (asked) => (asked === "notThereAtAll" ? {} : (held as unknown as Record<string, unknown>)),
            say: (message) => {
                said.push(message);
            },
            sendCoverage: async () => undefined,
            reached,
            ticked: new Set(["held.ts:plain:entered"]),
        },
    };
}

// Every path the model holds, so a unit that asks what has run is told everything has and makes one
// call rather than working through every value it could pass.
const everything = async (): Promise<Set<string>> => new Set(file.paths.map((one) => one.name));

// One call unit over every function the model holds.
export async function aCallUnitOverEveryFunction(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const { runtime, said } = runtimeFor(everything);
    const factories = await readFactories(runtime, model);
    for (let at = 0; at < functions.length; at += 1) {
        const unit: Unit = { index: at, kind: "call", seed: 1, faulting: at % 2 === 1, file: 0, fn: at };
        if (!(await runUnit(runtime, model, unit, factories))) {
            throw new Error(`TheRunStoppedOn_${functions[at]!.label}`);
        }
    }
    if (!said.some((one) => one.type === "unit")) {
        throw new Error("TheDrivingSaidNothingAboutAnyUnit");
    }
}

// One exploring unit over every function the model holds.
export async function anExploringUnitOverEveryFunction(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const { runtime } = runtimeFor(everything);
    const factories = await readFactories(runtime, model);
    for (let at = 0; at < functions.length; at += 1) {
        const unit: Unit = { index: at, kind: "explore", seed: 1, faulting: false, file: 0, fn: at };
        if (!(await runUnit(runtime, model, unit, factories))) {
            throw new Error(`TheRunStoppedOn_${functions[at]!.label}`);
        }
    }
}

// A unit whose runtime cannot say what has run, which works through every value it could pass.
export async function aUnitThatCannotAskWhatHasRun(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const { runtime } = runtimeFor();
    await runUnit(runtime, model, { index: 0, kind: "call", seed: 1, faulting: false, file: 0, fn: 0 }, []);
    await runUnit(runtime, model, { index: 0, kind: "explore", seed: 1, faulting: true, file: 0, fn: 2 }, []);
}

// A scenario that passes, one that says the answer is wrong, and one that is not there.
export async function everyWayAScenarioGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const { runtime, said } = runtimeFor();
    const factories = await readFactories(runtime, model);
    if (!(await runUnit(runtime, model, { index: 0, kind: "scenario", seed: 1, faulting: false, scenario: 0 }, factories))) {
        throw new Error("TheScenarioThatPassesStoppedTheRun");
    }
    if (await runUnit(runtime, model, { index: 1, kind: "scenario", seed: 1, faulting: false, scenario: 1 }, factories)) {
        throw new Error("TheScenarioThatFailedDidNotStopTheRun");
    }
    if (!said.some((one) => one.type === "failed" && one.kind === "scenario")) {
        throw new Error("TheDrivingDidNotSayTheScenarioFailed");
    }
}

// An invariant that holds and one that stops holding.
export async function everyWayAnInvariantGoes(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const { runtime, said } = runtimeFor();
    const broken: RunModel = { ...model, invariants: [{ file: "held.sim.ts", exportName: "aBrokenInvariant", line: 5, module: "held.sim.mjs" }] };
    const unit: Unit = { index: 0, kind: "call", seed: 1, faulting: false, file: 0, fn: 0 };
    if (await runUnit(runtime, broken, unit, [])) {
        throw new Error("TheBrokenInvariantDidNotStopTheRun");
    }
    if (!said.some((one) => one.type === "failed" && one.kind === "invariant")) {
        throw new Error("TheDrivingDidNotSayTheInvariantStoppedHolding");
    }
}

// A runtime that can say what has run, so a unit stops as soon as every path it is after has run.
export async function aUnitStopsOnceEveryPathHasRun(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const everything = new Set(file.paths.map((one) => one.name));
    const { runtime: stops, said: stopped } = runtimeFor(async () => everything);
    await runUnit(stops, model, { index: 0, kind: "call", seed: 1, faulting: false, file: 0, fn: 0 }, []);
    await runUnit(stops, model, { index: 0, kind: "explore", seed: 1, faulting: false, file: 0, fn: 0 }, []);

    let asked = 0;
    const { runtime: carriesOn } = runtimeFor(async () => {
        asked += 1;
        return asked > 3 ? everything : new Set<string>();
    });
    await runUnit(carriesOn, model, { index: 0, kind: "call", seed: 1, faulting: false, file: 0, fn: 0 }, []);

    const first = stopped.find((one) => one.type === "unit");
    if (first === undefined || first.type !== "unit" || first.calls > 1) {
        throw new Error("TheUnitDidNotStopOnceEveryPathHadRun");
    }
}

// The factories a sim file holds, including one whose file the run never loaded and one the module
// does not export.
export async function theFactoriesASimFileHolds(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const { runtime } = runtimeFor();
    const made = await readFactories(runtime, model);
    if (made.length !== 1) {
        throw new Error("TheReadingFoundTheWrongNumberOfFactories");
    }
    const maker = { subject: { rng: { pick: <T>(items: readonly T[]): T => items[0]!, int: () => 0 } }, make: () => 1, spoiled: (one: unknown) => one };
    made[0]!.make(maker as never);

    await readFactories(runtime, { ...model, factories: [{ key: "a", typeName: "A", file: "nowhere.sim.ts", exportName: "aFactory", parameters: [] }] });
    await readFactories(runtime, { ...model, factories: [{ key: "a", typeName: "A", file: "held.sim.ts", exportName: "notThereAtAll", parameters: [] }] });
    await readFactories(runtime, {
        ...model,
        factories: [{ key: "a", typeName: "A", file: "held.sim.ts", exportName: "Made", method: "method", parameters: [{ name: "a", optional: false, rest: false, recipe: { kind: "string" } }], ownerParameters: [{ name: "at", optional: false, rest: false, recipe: { kind: "number" } }] }],
    });
}

// A run whose module will not load at all, which is what a broken import looks like from here.
export async function aModuleThatWillNotLoad(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const said: FromDriver[] = [];
    const runtime: Runtime = {
        load: async () => {
            throw new Error("ThisModuleWillNotLoad");
        },
        say: (message) => {
            said.push(message);
        },
        sendCoverage: async () => undefined,
        ticked: new Set(),
    };
    let refused = false;
    try {
        await runUnit(runtime, model, { index: 0, kind: "call", seed: 1, faulting: false, file: 0, fn: 0 }, []);
    }
    catch {
        refused = true;
    }
    if (!refused) {
        throw new Error("TheDrivingCarriedOnWithAModuleThatWillNotLoad");
    }
}

// The list of factories the driving is handed, which is what a call with no factory falls back from.
export function aCallWithNoFactory(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const none: CallableFactory[] = [];
    if (none.length !== 0) {
        throw new Error("TheEmptyListWasNotEmpty");
    }
}
