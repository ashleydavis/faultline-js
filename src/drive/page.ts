// The browser side of a run.
//
// It is loaded into a page, works through the same list the Node side does, and says what it did by
// leaving it where the process outside the page can read it. Coverage is not read in here: the
// browser is driven from outside, and what V8 counted is taken from there.

import { startDriving } from "../effects/current.ts";
import { installGlobals } from "../effects/globals.ts";
import type { RunModel } from "../model.ts";
import { askedFromPage, type FromDriver, type Unit } from "./protocol.ts";
import { readFactories, runUnit, type Runtime } from "./work.ts";

// Where the page leaves what it has said, for the process outside to read.
export const saidOnPage = "__faultlineSaid";

// Starts the run inside the page. `model` is the run, `units` is the work, and `ticked` is what
// earlier rounds reached.
export async function driveInPage(model: RunModel, units: Unit[], ticked: string[]): Promise<FromDriver[]> {
    const asked = (globalThis as unknown as Record<string, (file: string) => Promise<string[]>>)[askedFromPage];
    // The page's own clock, network, socket and stores are replaced before any of the project is
    // loaded, so a module that reads one at its top level reads this run's.
    installGlobals();
    startDriving();
    const said: FromDriver[] = [];
    const runtime: Runtime = {
        // A copy is served over the same address the page was, so its path under the work directory
        // is the path to ask for.
        load: async (file) => (await import(`/${file.slice(model.work.length + 1)}`)) as Record<string, unknown>,
        say: (message) => {
            said.push(message);
        },
        // Coverage is taken from outside the page, so there is none to send from in here.
        sendCoverage: async () => {},
        // What has run is counted outside the page, where the maps back to the source are, so the
        // question goes out and the answer comes back.
        reached: asked === undefined ? undefined : async (file) => new Set(await asked(file.file)),
        ticked: new Set(ticked),
    };

    let factories;
    try {
        factories = await readFactories(runtime, model);
    }
    catch (thrown) {
        // Loading a module fails with an Error, so its message is what there is to say.
        said.push({ type: "broke", error: (thrown as Error).message });
        return said;
    }

    for (const unit of units) {
        try {
            if (!(await runUnit(runtime, model, unit, factories))) {
                return said;
            }
        }
        catch (thrown) {
            // A unit answers with a wrong answer rather than throwing, so what gets here is the run
            // failing to build or load something, which is an Error.
            said.push({ type: "broke", error: (thrown as Error).message });
            return said;
        }
    }
    said.push({ type: "finished" });
    return said;
}
