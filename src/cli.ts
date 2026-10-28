//
// The command line: reads what was asked for, runs it and says what the process exits with.
//

import assert from "node:assert/strict";
import path from "node:path";
import { readSelection, walkSources } from "./discover/sources.ts";
import { readOptions, type IOptions } from "./options.ts";
import { runReplay } from "./run/replay.ts";
import { compileCacheDirectory } from "./run/compile-cache.ts";
import { clearResults, resultsDirectoryOf } from "./run/results-cache.ts";
import { runProject, type IRunEnvironment } from "./run/run.ts";

//
// Runs the command typed after `flt` in the project `environment` describes. It hands back what the
// process exits with rather than exiting itself, so a test can call it and read the answer. A bare
// `npx flt` runs Faultline over the whole project.
//
export async function main(argumentList: string[], environment: IRunEnvironment): Promise<number> {
    assert(Array.isArray(argumentList));
    assert(path.isAbsolute(environment.projectRoot));
    const read = readOptions(argumentList);
    if (!read.ok) {
        environment.output.printError(read.error.message);
        return 1;
    }
    const options = read.value;
    if (options.command === "clear") {
        return clearCommand(environment);
    }
    if (options.command === "replay") {
        return replayCommand(environment, options);
    }
    return runProject(environment, options);
}

//
// `flt clear`: throws away every kept result and every compiled file, so the next run compiles and
// executes every file. The kept crashes are left.
//
export async function clearCommand(environment: IRunEnvironment): Promise<number> {
    const root = environment.projectRoot;
    const directory = resultsDirectoryOf(root);
    await clearResults(environment.files, root);
    const compiled = compileCacheDirectory(root);
    await environment.files.removeDirectory(compiled);
    const shown = path.relative(root, directory).split(path.sep).join("/");
    assert(!shown.startsWith(".."));
    const shownCompiled = path.relative(root, compiled).split(path.sep).join("/");
    assert(!shownCompiled.startsWith(".."));
    environment.output.print(`Threw away the kept results in ${shown} and the compiled files in ${shownCompiled}, so the next run compiles and executes every file.`);
    return 0;
}

//
// `flt --replay "<token>"`: walks the project as a run would and replays the token in it.
//
export async function replayCommand(environment: IRunEnvironment, options: IOptions): Promise<number> {
    assert.equal(options.command, "replay");
    const token = options.token;
    assert(token !== undefined);
    const root = environment.projectRoot;
    const selection = await readSelection(environment.files, root);
    if (!selection.ok) {
        environment.output.printError(selection.error.message);
        return 1;
    }
    const walked = await walkSources(environment.files, {
        root,
        include: selection.value.include,
        exclude: selection.value.exclude,
    });
    return runReplay({
        files: environment.files,
        projectRoot: root,
        walked,
        text: token,
        createWorker: () => environment.createWorker(),
        print: (line: string) => environment.output.print(line),
    });
}
