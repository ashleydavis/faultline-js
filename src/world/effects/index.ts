//
// Which built in modules a run replaces and where each replacement sits.
//
// The copy imports these instead of the real ones, so code that reads a file or reaches the network
// the way it always did is exercised against a run's own tree without the project declaring
// anything.
//

import assert from "node:assert/strict";
import path from "node:path";
import type { IFileSystem } from "../../lib/file-system.ts";

//
// The module that stands in for each built in one, by the name the code under test imports.
//
// Both spellings are here because a project writes either. To the runtime `node:fs` and `fs` are
// the same module.
//
const effectModuleNames = new Map<string, string>([
    ["node:fs", "fs"],
    ["fs", "fs"],
    ["node:fs/promises", "fs-promises"],
    ["fs/promises", "fs-promises"],
    ["node:dns", "dns"],
    ["dns", "dns"],
    ["node:dns/promises", "dns-promises"],
    ["dns/promises", "dns-promises"],
    ["node:http", "http"],
    ["http", "http"],
    ["node:https", "http"],
    ["https", "http"],
    ["node:net", "net"],
    ["net", "net"],
    ["node:child_process", "child-process"],
    ["child_process", "child-process"],
    ["node:os", "os"],
    ["os", "os"],
    ["node:crypto", "crypto"],
    ["crypto", "crypto"],
    ["node:timers", "timers"],
    ["timers", "timers"],
    ["node:timers/promises", "timers-promises"],
    ["timers/promises", "timers-promises"],
    ["node:inspector", "inspector"],
    ["inspector", "inspector"],
    ["node:inspector/promises", "inspector"],
    ["inspector/promises", "inspector"],
]);

//
// Where every replacement sits on this machine, by each name the code under test imports it by,
// for a caller that has to answer without waiting, such as a hook resolving a `require`.
//
export async function effectModuleFiles(files: IFileSystem, directory: string): Promise<Map<string, string>> {
    assert(path.isAbsolute(directory));
    const found = new Map<string, string>();
    for (const specifier of effectModuleNames.keys()) {
        const file = await effectModuleFor(files, specifier, directory);
        if (file) {
            found.set(specifier, file);
        }
    }
    assert(found.size <= effectModuleNames.size);
    return found;
}

//
// Where one replacement sits on this machine, or undefined when the name is not one that is
// replaced. `directory` is where the replacements sit, which only the caller knows.
//
// The JavaScript is looked for ahead of the TypeScript because an installed copy runs what the
// build emitted (Node refuses to take the types out of a TypeScript file inside node_modules) and a
// clone, which holds no build output beside its sources, runs the tool's own TypeScript.
//
export async function effectModuleFor(files: IFileSystem, specifier: string, directory: string): Promise<string | undefined> {
    assert(path.isAbsolute(directory));
    assert(specifier.length > 0);
    const name = effectModuleNames.get(specifier);
    if (!name) {
        return undefined;
    }
    for (const extension of [".js", ".ts"]) {
        const where = path.join(directory, `${name}${extension}`);
        if (await files.isFile(where)) {
            assert(path.isAbsolute(where));
            return where;
        }
    }
    return undefined;
}
