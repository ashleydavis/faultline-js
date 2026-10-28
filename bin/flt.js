#!/usr/bin/env node
//
// What `flt` runs. It does no work of its own: everything is in the tool's own modules, so a test
// starts the same run by calling `main` directly.
//
// A clone runs the source, so what you are editing is what runs and there is no build to remember.
// An installed copy runs what the build emitted, because Node refuses to take the types out of a
// TypeScript file inside node_modules. Which of the two exists is known only when this runs, so the
// module is imported with `import()` rather than a static import.
//

import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../src/cli.ts", import.meta.url);
const packageFile = new URL("../package.json", import.meta.url);

//
// Whether the TypeScript source sits beside this file, which is true in a clone and false in an
// installed copy.
//
async function hasSource() {
    try {
        await access(fileURLToPath(source));
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

const cloned = await hasSource();
const modules = cloned ? new URL("../src/", import.meta.url) : new URL("../dist/", import.meta.url);
const extension = cloned ? ".ts" : ".js";

//
// The runtime is checked before the run is imported, so a Node too old for Faultline gets the one
// sentence that says so.
//
const { nodeVersionRefusal, readRequiredNode } = await import(new URL(`load/node-version${extension}`, modules).href);
const refusal = nodeVersionRefusal(process.versions, await readRequiredNode(fileURLToPath(packageFile)));

if (refusal === undefined) {
    const { main } = await import(new URL(`cli${extension}`, modules).href);
    process.exitCode = await main(process.argv.slice(2), process.cwd());
}
else {
    process.stderr.write(`${refusal}\n`);
    process.exitCode = 1;
}
