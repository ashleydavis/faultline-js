// Scenarios for the browser side of a run.
//
// It is written to be loaded into a page, and what it does turns on a run rather than on a made up
// value, so these build one and call it the way a page calls it.
//
// The copies it loads are asked for by the path they sit at under the work directory, which in a
// page is a path on the server and here is a path on this machine. A run with no work directory
// named therefore asks for the copies by where they really are, and the copies a run measuring this
// file made are what there is to load.

import { fileURLToPath } from "node:url";
import type { Checklist, Injector } from "faultline";
import type { RunModel } from "../model.ts";
import { driveInPage } from "./page.ts";
import { askedFromPage, type Unit } from "./protocol.ts";

// A run with nothing in it, which the page works through and says it has finished.
function nothingToDrive(): RunModel {
    return {
        root: "/project",
        work: "",
        files: [],
        factories: [],
        scenarios: [],
        invariants: [],
        simModules: {},
        unseen: [],
        seeds: [1],
        callBudget: 200,
    } as unknown as RunModel;
}

// Where one of this run's own copies sits, which is a module the page can load.
function copyBeside(name: string): string {
    return fileURLToPath(new URL(`./${name}`, import.meta.url));
}

// A page driven with nothing to drive, both with and without a way to ask what has run.
export async function aPageWithNothingToDrive(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const asking = globalThis as unknown as Record<string, unknown>;
    const held = asking[askedFromPage];
    delete asking[askedFromPage];
    try {
        const said = await driveInPage(nothingToDrive(), [], []);
        if (said.length !== 1 || said[0]!.type !== "finished") {
            throw new Error("APageWithNothingToDriveDidNotSayItHadFinished");
        }

        // And again with the way out of the page in place, which is what a real page has, driving a
        // unit so the page asks it what has run.
        asking[askedFromPage] = async (): Promise<string[]> => [];
        const driving = nothingToDrive();
        driving.files = [
            {
                file: "held.ts",
                module: copyBeside("values.mjs"),
                functions: [{ label: "standIn", file: "held.ts", line: 1, async: false, parameters: [], reach: { how: "export", name: "standIn" } }],
                classes: [],
                paths: [{ name: "standIn:entered", describe: "the body of standIn", file: "held.ts", line: 1, fn: "standIn", at: { line: 1, column: 0 } }],
                tests: [],
                properties: [],
            },
        ];
        await driveInPage(driving, [{ index: 0, kind: "call", seed: 1, faulting: false, file: 0, fn: 0 }], []);
    }
    finally {
        if (held === undefined) {
            delete asking[askedFromPage];
        }
        else {
            asking[askedFromPage] = held;
        }
    }
}

// A page whose test input factories will not load, which it says rather than driving anything.
export async function aPageWhoseFactoriesWillNotLoad(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const model = nothingToDrive();
    model.factories = [{ key: "a#Held", typeName: "Held", file: "a.sim.ts", exportName: "aFactory", parameters: [] }];
    model.simModules = { "a.sim.ts": "/there-is-no-module-here.mjs" };
    const said = await driveInPage(model, [], []);
    if (said.length !== 1 || said[0]!.type !== "broke") {
        throw new Error("APageWhoseFactoriesWillNotLoadDidNotSaySo");
    }
}

// A page whose unit will not load, and one whose scenario says the answer is wrong.
export async function aPageWhoseWorkGoesWrong(injector: Injector, checklist: Checklist): Promise<void> {
    void injector;
    void checklist;

    const model = nothingToDrive();
    model.files = [
        {
            file: "held.ts",
            module: "/there-is-no-module-here.mjs",
            functions: [{ label: "greet", file: "held.ts", line: 1, async: false, parameters: [], reach: { how: "export", name: "greet" } }],
            classes: [],
            paths: [],
            tests: [],
            properties: [],
        },
    ];
    const unit: Unit = { index: 0, kind: "call", seed: 1, faulting: false, file: 0, fn: 0 };
    const said = await driveInPage(model, [unit], []);
    if (said.length !== 1 || said[0]!.type !== "broke") {
        throw new Error("APageWhoseUnitWillNotLoadDidNotSaySo");
    }

    // A scenario that throws, which stops the page where it is rather than breaking it. A class is
    // what is called: calling one without `new` throws, whatever it was written to do.
    const failing = nothingToDrive();
    failing.scenarios = [{ file: "held.sim.ts", exportName: "CannotBuild", line: 1, module: copyBeside("values.mjs") }];
    const stopped = await driveInPage(failing, [{ index: 0, kind: "scenario", seed: 1, faulting: false, scenario: 0 }], []);
    if (stopped.some((one) => one.type === "finished")) {
        throw new Error("APageWhoseScenarioFailedSaidItHadFinished");
    }
}
