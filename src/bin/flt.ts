#!/usr/bin/env node
//
// What `flt` runs. It hands its own URL, the real file system and the real worker factory to
// `main` in `src/main.ts`, which does the work. It holds nothing else, because a unit test cannot
// load a file that reads `import.meta`.
//

import { FileSystem } from "../lib/file-system.ts";
import { main } from "../main.ts";
import { WorkerFactory } from "../run/worker.ts";

await main(import.meta.url, new FileSystem(), new WorkerFactory());
