//
// Where Faultline keeps what it carries from one run to the next in a project: the kept crashes and
// the kept results.
//

import assert from "node:assert/strict";
import path from "node:path";

//
// The directory Faultline keeps its files in: `node_modules/.cache/faultline/` in the project,
// which every Node project already leaves out of git and which tools that keep a cache share, so
// Faultline writes nothing into the project's own files.
//
export function cacheDirectoryOf(projectRoot: string): string {
    assert(path.isAbsolute(projectRoot));
    return path.join(projectRoot, "node_modules", ".cache", "faultline");
}
