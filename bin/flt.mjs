#!/usr/bin/env node
// What `flt` runs. It does no work of its own: everything is in the tool's own modules, so a test
// starts the same run by calling `main` directly.
//
// An installed copy runs what `npm run build` emitted, because Node refuses to take the types out
// of a TypeScript file inside node_modules. A clone runs the source, so there is nothing to build
// before working on it.

import fs from "node:fs";
import { fileURLToPath } from "node:url";

const built = new URL("../dist/cli.js", import.meta.url);
const source = new URL("../src/cli.ts", import.meta.url);
const { main } = await import(fs.existsSync(fileURLToPath(built)) ? built.href : source.href);

process.exitCode = await main(process.argv.slice(2), process.cwd());
