//
// Writes the small project a smoke check loads, under the repository's `tmp/smoke/checks/`, so a
// check reads a real project on the disk the way a run does and the repository holds no copy of
// it. The directory is emptied first, so what an earlier run left there never changes a check.
//

import assert from "node:assert/strict";
import path from "node:path";
import type { IFileSystem } from "../lib/file-system.ts";

//
// Writes `files`, each by its path relative to the project, into the project called `name` and
// hands back the project's absolute path.
//
export async function writeCheckProject(fileSystem: IFileSystem, name: string, files: Record<string, string>): Promise<string> {
    assert(/^[a-z-]+$/.test(name), `${name} is not a name a check project can have.`);
    assert(Object.keys(files).length > 0, `The check project ${name} has no files.`);
    const root = path.resolve(import.meta.dirname, "../../tmp/smoke/checks", name);
    await fileSystem.removeDirectory(root);
    for (const [file, text] of Object.entries(files)) {
        const full = path.join(root, file);
        await fileSystem.makeDirectory(path.dirname(full));
        await fileSystem.writeText(full, text);
    }
    assert(await fileSystem.isDirectory(root), `The check project ${name} was not written to ${root}.`);
    return root;
}
