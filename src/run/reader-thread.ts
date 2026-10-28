//
// The thread the child reads shards and measures files on. The child starts it with the settings
// its loader needs and the sim types, and it answers each request with a reply carrying the same
// number. Its isolate is not the one the child reads coverage from, so the compiler's functions and
// the programs it builds cost the child's coverage readings nothing.
//

import assert from "node:assert/strict";
import { parentPort, workerData } from "node:worker_threads";
import { FileSystem } from "../lib/file-system.ts";
import { createLoader, type ILoadSettings } from "../load/hooks.ts";
import { CachedShardReader, compileCacheDirectory } from "./compile-cache.ts";
import { answerReaderRequest, LocalShardReader, type IReaderRequest } from "./shard-reader.ts";

//
// What the child starts the thread with.
//
export interface IReaderThreadSettings {
    //
    // The project and Faultline's own modules, as the loader needs them.
    //
    load: ILoadSettings;

    //
    // The files that declare the sim types.
    //
    simTypes: string[];
}

//
// Answers the child's requests until the child ends.
//
export function main(): void {
    const port = parentPort;
    assert(port !== null, "The reader thread was started outside a worker thread.");
    const settings: IReaderThreadSettings = workerData;
    assert(settings.simTypes.length > 0);
    const files = new FileSystem();
    const loader = createLoader(settings.load, files);
    const reader = new CachedShardReader({
        inner: new LocalShardReader(loader, settings.simTypes),
        loader,
        files,
        directory: compileCacheDirectory(settings.load.projectRoot),
    });
    port.on("message", (request: IReaderRequest) => {
        answerReaderRequest(reader, request).then((reply) => {
            port.postMessage(reply);
        }, (error: unknown) => {
            assert.fail(`The reader thread could not answer request ${request.id}: ${String(error)}`);
        });
    });
}

main();
