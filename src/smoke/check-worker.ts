//
// Starts the real worker a smoke check makes its calls with, and opens a shard in it, the way a run
// does: a child process running `run/child-main` from this clone's own source.
//

import assert from "node:assert/strict";
import path from "node:path";
import type { Walked } from "../discover/sources.ts";
import { listShards } from "../run/driver.ts";
import type { IOpenRequest } from "../run/messages.ts";
import { createWorker, defaultWorkerSettings, WorkerFactory, type IWorker } from "../run/worker.ts";

//
// The directory Faultline's own modules sit in: `src` in this clone, because a check runs the
// source it sits beside rather than a build that may be out of date.
//
export const toolModules = path.resolve(import.meta.dirname, "..");

//
// A worker for the project at `root`, whose children run this clone's source.
//
export function startCheckWorker(root: string): IWorker {
    assert(path.isAbsolute(root), `${root} is not an absolute path.`);
    const settings = defaultWorkerSettings(root, toolModules, path.join(toolModules, "run", "child-main.ts"));
    assert.equal(settings.child.projectRoot, root);
    return createWorker(settings, new WorkerFactory());
}

//
// The request that opens the shard of `file` in the project `walked` describes. The seed is fixed,
// so every run of a check makes the same calls.
//
export function openRequestOf(walked: Walked, file: string): IOpenRequest {
    assert(!path.isAbsolute(file), `${file} is not a path relative to the project.`);
    const shard = listShards(walked).find((candidate) => candidate.file === file);
    assert(shard, `The project has no shard for ${file}.`);
    return {
        kind: "open",
        file: shard.file,
        sims: shard.sims,
        seed: 1,
    };
}
