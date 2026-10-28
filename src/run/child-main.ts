//
// The child process a worker starts: it sets the process up and then answers the worker's requests
// with `serveChild`.
//
// The order matters. Faultline's own modules are imported first, by the static imports below, so
// they keep the real built-in modules. Coverage starts next, because a function V8 compiled before
// it started has no block counters. The globals are replaced and the module hooks registered last,
// so every project file loaded after this reaches the simulated world. The hooks run on Node's
// loader thread, from `load/loader-thread`, which reads files without blocking this one.
//

import { Session } from "node:inspector/promises";
import assert from "node:assert/strict";
import module from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { startCoverage, takeCoverage } from "../coverage/v8.ts";
import { FileSystem } from "../lib/file-system.ts";
import { createLoader, type ILoadSettings } from "../load/hooks.ts";
import { createKeptAnswers, registerKeptHooks } from "../load/kept-hooks.ts";
import { startDriving } from "../world/current.ts";
import { effectModuleFiles } from "../world/effects/index.ts";
import { installGlobals } from "../world/globals.ts";
import { ProcessEventLoop, type ICallWatch } from "./call.ts";
import { createChild, isChildSettings, serveChild } from "./child.ts";
import type { IReply } from "./messages.ts";
import type { IReaderThreadSettings } from "./reader-thread.ts";
import { ThreadShardReader } from "./shard-reader.ts";

//
// Sets the process up and starts answering requests.
//
export async function main(): Promise<void> {
    const channel = process.send;
    if (!channel) {
        process.stderr.write("The Faultline child process was started without a channel to its worker, so it has no work to do.\n");
        process.exitCode = 1;
        return;
    }

    //
    // Held from before the globals are replaced: the replaced ones send nothing and exit nowhere
    // while a run is driving the code under test.
    //
    const send = channel.bind(process);
    const realStderr = process.stderr;
    const realExit = process.exit.bind(process);
    const written = process.argv[2];
    assert(written !== undefined, "The Faultline child process was started without its settings.");
    const settings: unknown = JSON.parse(written);
    assert(isChildSettings(settings), `The Faultline child process was started with settings it cannot read: ${written}`);
    process.setSourceMapsEnabled(true);
    const here = fileURLToPath(import.meta.url);
    const loadSettings: ILoadSettings = {
        projectRoot: settings.projectRoot,
        toolModules: settings.toolModules,
    };

    //
    // The reader thread is started before coverage, the globals and the module hooks, so it runs
    // with the real modules and none of them. It is unreferenced, so it never counts as real work
    // a call is waiting on, and it ends with this process.
    //
    const readerSettings: IReaderThreadSettings = {
        load: loadSettings,
        simTypes: settings.simTypes,
    };
    const readerThread = new Worker(path.join(path.dirname(here), `reader-thread${path.extname(here)}`), {
        workerData: readerSettings,
    });
    readerThread.unref();
    const reader = new ThreadShardReader(readerThread);
    const session = new Session();
    session.connect();
    await startCoverage(session);
    const watch: ICallWatch = {
        uncaught: [],
    };
    process.on("uncaughtException", (error: unknown) => {
        watch.uncaught.push(error);
    });
    process.on("unhandledRejection", (error: unknown) => {
        watch.uncaught.push(error);
    });

    //
    // A worker that went away has no more requests to send, so the child ends with it.
    //
    process.on("disconnect", () => {
        realExit(0);
    });
    installGlobals();
    startDriving();

    //
    // The loader thread's module sits beside this file's own, as TypeScript in a clone and as
    // JavaScript installed.
    //
    const loaderThread = path.join(path.dirname(here), "..", "load", `loader-thread${path.extname(here)}`);
    assert(path.isAbsolute(loaderThread));
    module.register(pathToFileURL(loaderThread).href, {
        parentURL: import.meta.url,
        data: loadSettings,
    });

    //
    // The hooks on this thread answer each later copy of a project file from the answers the
    // loader thread gave the first time, so a call does not wait on a round trip to that thread
    // for every import. They also send every built-in module Faultline simulates to the simulated
    // one, because a `require` never reaches the loader thread's hooks.
    //
    const simulated = await effectModuleFiles(new FileSystem(), path.join(settings.toolModules, "world", "effects"));
    registerKeptHooks(createKeptAnswers(simulated, settings.toolModules), module.registerHooks);

    //
    // This thread's loader gives the judge the text of a file that crashed.
    //
    const loader = createLoader(loadSettings, new FileSystem());
    const child = createChild({
        settings,
        loader,
        reader,

        //
        // A project file is named by a path only known while the run is going, so it can only be
        // imported this way. The module hooks registered above load it.
        //
        importFile: (url: string) => import(url),
        takeCoverage: () => takeCoverage(session),
        eventLoop: new ProcessEventLoop(),
        watch,
    });
    serveChild(child, process, (message: IReply) => {
        send(message);
    }, (error: unknown) => {
        realStderr.write(`The Faultline child process failed, which is a defect in Faultline: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
        realExit(1);
    });
}

await main();
