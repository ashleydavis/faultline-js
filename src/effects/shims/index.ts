// Which built in modules a run replaces, and where the replacement sits.
//
// The copy imports these instead of the real ones, so code that reads a file or reaches the network
// the way it always did is exercised against a run's own tree without the project declaring
// anything.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

// The module that stands in for each built in one, by the name the code under test imports.
//
// Both spellings are here because a project writes either, and `node:fs` and `fs` are the same
// module to the runtime.
const shimNames: Record<string, string> = {
    "node:fs": "fs",
    fs: "fs",
    "node:fs/promises": "fs-promises",
    "fs/promises": "fs-promises",
    "node:dns": "dns",
    dns: "dns",
    "node:dns/promises": "dns-promises",
    "dns/promises": "dns-promises",
    "node:http": "http",
    http: "http",
    "node:https": "http",
    https: "http",
    "node:net": "net",
    net: "net",
    "node:child_process": "child-process",
    child_process: "child-process",
};

// Where one replacement sits on this machine, or nothing when the name is not one that is replaced.
//
// A clone runs the tool's own TypeScript and an installed copy runs what the build emitted, because
// Node refuses to take the types out of a TypeScript file inside node_modules.
export function shimFor(specifier: string): string | undefined {
    const name = shimNames[specifier];
    if (name === undefined) {
        return undefined;
    }
    for (const extension of [".js", ".ts"]) {
        const where = fileURLToPath(new URL(`./${name}${extension}`, import.meta.url));
        if (fs.existsSync(where)) {
            return where;
        }
    }
    return undefined;
}
