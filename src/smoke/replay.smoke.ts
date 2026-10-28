//
// Checks, with real child processes, that every call Faultline makes is independent of the calls
// before it and that a replay gives the answer the run gave.
//
// The project it writes crashes on the third call made in one copy of its module. The check makes
// every call of its shard in a real worker, as a run does, and then replays the shard's third call
// twice, each time in a new child. Every call gets a copy of the module of its own, so the run
// finds no crash, and both replays give back exactly what the run's third call did.
//

import assert from "node:assert/strict";
import { walkSources } from "../discover/sources.ts";
import { FileSystem } from "../lib/file-system.ts";
import { exploreShard, type IShardResult } from "../run/explore.ts";
import type { ICallResult } from "../run/messages.ts";
import { replayCall } from "../run/replay.ts";
import { writeCheckProject } from "./check-project.ts";
import { openRequestOf, startCheckWorker } from "./check-worker.ts";

//
// Writes the project, makes the shard's calls, replays the third and compares.
//
export async function main(): Promise<void> {
    const fileSystem = new FileSystem();
    const root = await writeCheckProject(fileSystem, "counts-calls", {
        "package.json": "{ \"name\": \"counts-calls\", \"type\": \"module\" }\n",
        "src/count.ts": [
            "let calls = 0;",
            "export function step(limit: number): number {",
            "    calls += 1;",
            "    if (calls === 3) {",
            "        const missing: number[] | undefined = undefined;",
            "        return missing!.length;",
            "    }",
            "    return limit + calls;",
            "}",
            "",
        ].join("\n"),
    });
    const walked = await walkSources(fileSystem, {
        root,
        include: [],
        exclude: [],
    });
    const made: ICallResult[] = [];
    const worker = startCheckWorker(root);
    let found: IShardResult;
    try {
        found = await exploreShard({
            open: (request) => worker.open(request),
            async call(token: string): Promise<ICallResult> {
                const result = await worker.call(token);
                made.push(result);
                return result;
            },
            read: () => worker.read(),
        }, openRequestOf(walked, "src/count.ts"));
    }
    finally {
        await worker.stop();
    }
    assert.deepEqual(found.failures, [], "A call saw the state an earlier call left in the module.");
    const steps = made.filter((result) => result.token.startsWith("src/count.ts:step;"));
    assert(steps.length >= 3, `The run made ${steps.length} calls of step, and the check needs three.`);
    const third = steps[2];
    for (const attempt of [1, 2]) {
        const replayed = await replayCall(walked, third.token, () => startCheckWorker(root));
        assert(replayed.ok, `Replay ${attempt} of ${third.token} was refused.`);
        assert.deepEqual(replayed.value, third, `Replay ${attempt} of ${third.token} gave another answer than the run.`);
    }
    process.stdout.write("Every call is independent of the calls before it and a replay gives the answer the run gave.\n");
}

await main();
