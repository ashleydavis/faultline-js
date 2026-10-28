//
// Checks, with a real child process, that coverage is read per call from a project file loaded
// through the module hooks.
//
// It writes a one-function project, opens its shard in a real worker and calls the function with
// each of its boundary values, asking for a coverage reading after each. Each call's reading holds
// the side of the `if` its value takes and not the other side, so each reading is what that call
// exercised and nothing from the one before, and between them the calls exercise both sides. A
// call loads its own copy of the file first, so its reading holds the file's top level too.
//

import assert from "node:assert/strict";
import { walkSources } from "../discover/sources.ts";
import { FileSystem } from "../lib/file-system.ts";
import { fileOfPathKey } from "../run/measure.ts";
import type { ICallResult } from "../run/messages.ts";
import { writeToken } from "../run/token.ts";
import { writeCheckProject } from "./check-project.ts";
import { openRequestOf, startCheckWorker } from "./check-worker.ts";

//
// The names of the code paths of `src/pick.ts` one call exercised, sorted: those its result gave
// and those the reading taken after it gave.
//
export function exercisedNames(result: ICallResult, read: string[]): string[] {
    const keys = [...result.exercised, ...read].filter((key) => fileOfPathKey(key) === "src/pick.ts");
    const names = keys.map((key) => key.slice(key.indexOf("\t") + 1)).sort();
    assert.equal(names.length, keys.length);
    assert(names.every((name) => name.length > 0), `A code path of src/pick.ts in ${result.token} has no name.`);
    return names;
}

//
// Writes the project, makes the calls and checks each reading.
//
export async function main(): Promise<void> {
    const fileSystem = new FileSystem();
    const root = await writeCheckProject(fileSystem, "picks", {
        "package.json": "{ \"name\": \"picks\", \"type\": \"module\" }\n",
        "src/pick.ts": "export function pick(value: number): string {\n    if (value > 0) {\n        return \"plus\";\n    }\n    return \"minus\";\n}\n",
    });
    const walked = await walkSources(fileSystem, {
        root,
        include: [],
        exclude: [],
    });
    const worker = startCheckWorker(root);
    const sides = new Set<string>();
    try {
        const facts = await worker.open(openRequestOf(walked, "src/pick.ts"));
        const topLevel = await worker.call(writeToken({
            file: "src/pick.ts",
            name: "(top level)",
            seed: 1,
            values: [],
            failure: undefined,
        }));
        assert.deepEqual(exercisedNames(topLevel, await worker.read()), ["(top level):entered"]);
        const plan = facts.functions.find((candidate) => candidate.name === "pick");
        assert(plan, "The shard has no function pick.");
        const firstChoices = plan.choices[0];
        assert(firstChoices, "The function pick has no choices for its argument.");
        for (const choice of firstChoices.filter((candidate) => candidate.source === "boundary")) {
            const result = await worker.call(writeToken({
                file: "src/pick.ts",
                name: "pick",
                seed: 1,
                values: [choice],
                failure: undefined,
            }));
            const side = Number(result.arguments[0]) > 0 ? "if:2:true" : "if:2:false";
            assert.deepEqual(exercisedNames(result, await worker.read()), ["(top level):entered", side, "pick:entered"], `The call with ${result.arguments[0]} read other paths than its own.`);
            sides.add(side);
        }
    }
    finally {
        await worker.stop();
    }
    assert.equal(sides.size, 2, "The calls did not exercise both sides of the if.");
    process.stdout.write("Coverage read after each call holds what that call exercised.\n");
}

await main();
