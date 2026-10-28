//
// Checks, with a real child process, that a project file and a package in its `node_modules` both
// reach the simulated `node:fs` through the module hooks.
//
// It writes a small project with a package and a scenario, opens the scenario's shard in a real
// worker and runs it. The scenario writes a file through `node:fs` and expects to read it back
// through the project file and through the package. The file is never on the disk, so only the
// simulated filesystem can answer.
//

import assert from "node:assert/strict";
import path from "node:path";
import { walkSources } from "../discover/sources.ts";
import { FileSystem } from "../lib/file-system.ts";
import { writeToken } from "../run/token.ts";
import { writeCheckProject } from "./check-project.ts";
import { openRequestOf, startCheckWorker, toolModules } from "./check-worker.ts";

//
// Where the scenario writes the file, which the check then looks for on the disk. It sits in a
// directory at the root that no machine has, so finding it on the disk can only mean the write
// left the simulated world.
//
export const sharedFile = "/faultline-check/only-in-the-run.txt";

//
// Writes the project, runs the scenario and checks what it found.
//
export async function main(): Promise<void> {
    const fileSystem = new FileSystem();
    const root = await writeCheckProject(fileSystem, "reads-files", {
        "package.json": "{ \"name\": \"reads-files\", \"type\": \"module\" }\n",
        "tsconfig.json": JSON.stringify({
            compilerOptions: {
                module: "ESNext",
                moduleResolution: "bundler",
                allowImportingTsExtensions: true,
                noEmit: true,
                paths: {
                    faultline: [path.join(toolModules, "sim", "index.ts")],
                },
            },
        }),
        "src/main.ts": [
            "import fs from \"node:fs\";",
            "import { readFromPackage } from \"reader\";",
            "export function readInProject(file: string): string {",
            "    return fs.readFileSync(file, \"utf8\");",
            "}",
            "export function readInPackage(file: string): string {",
            "    return readFromPackage(file);",
            "}",
            "",
        ].join("\n"),
        "src/main.sim.ts": [
            "import fs from \"node:fs\";",
            "import type { ScenarioContext } from \"faultline\";",
            "import { readInPackage, readInProject } from \"./main.ts\";",
            "export function readOrError(read: (file: string) => string, file: string): string {",
            "    try {",
            "        return read(file);",
            "    }",
            "    catch (error) {",
            "        return String(error);",
            "    }",
            "}",
            "export function readsTheRunsTree(context: ScenarioContext): void {",
            `    fs.mkdirSync(${JSON.stringify(path.dirname(sharedFile))}, { recursive: true });`,
            `    fs.writeFileSync(${JSON.stringify(sharedFile)}, "simulated");`,
            `    context.expect(readOrError(readInProject, ${JSON.stringify(sharedFile)}) === "simulated", "the project file reads the run's tree");`,
            `    context.expect(readOrError(readInPackage, ${JSON.stringify(sharedFile)}) === "simulated", "the package reads the run's tree");`,
            "}",
            "",
        ].join("\n"),
        "node_modules/reader/package.json": "{ \"name\": \"reader\", \"type\": \"module\", \"main\": \"index.js\" }\n",
        "node_modules/reader/index.js": "import { readFileSync } from \"fs\";\nexport function readFromPackage(file) { return readFileSync(file, \"utf8\"); }\n",
    });
    const walked = await walkSources(fileSystem, {
        root,
        include: [],
        exclude: [],
    });
    const worker = startCheckWorker(root);
    try {
        const facts = await worker.open(openRequestOf(walked, "src/main.sim.ts"));
        assert.deepEqual(facts.simProblems, []);
        assert.deepEqual(facts.scenarios.map((scenario) => scenario.name), ["readsTheRunsTree"]);
        const result = await worker.call(writeToken({
            file: "src/main.sim.ts",
            name: "readsTheRunsTree",
            seed: 1,
            values: [],
            failure: undefined,
        }));
        assert.deepEqual(result.failures, [], "The scenario read something other than the run's tree.");
        assert(result.reached.length > 0, "The scenario reached no place of the simulated world.");
    }
    finally {
        await worker.stop();
    }
    assert(!(await fileSystem.isFile(sharedFile)), `The file the run wrote is on the disk at ${sharedFile}.`);
    assert(!(await fileSystem.isDirectory(path.dirname(sharedFile))), `The directory the run made is on the disk at ${path.dirname(sharedFile)}.`);
    process.stdout.write("A project file and a package both read the run's tree through node:fs.\n");
}

await main();
