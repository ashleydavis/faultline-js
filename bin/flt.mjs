#!/usr/bin/env node
// What `flt` runs. It does no work of its own: everything is in the tool's own modules, so a test
// starts the same run by calling `main` directly.
//
// A clone runs the source, so what you are editing is what runs and there is no build to remember.
// An installed copy has no source beside it and runs what the build emitted, because Node refuses
// to take the types out of a TypeScript file inside node_modules.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const source = new URL("../src/cli.ts", import.meta.url);
const built = new URL("../dist/cli.js", import.meta.url);
const { main } = await import(fs.existsSync(fileURLToPath(source)) ? source.href : built.href);

process.exitCode = await main(process.argv.slice(2), process.cwd());
