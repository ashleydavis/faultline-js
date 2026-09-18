// What the copy imports in place of `node:fs/promises`. It is the promise half of the replaced
// `node:fs`, so a project that uses both reads and writes one tree.

import { promises } from "./fs.ts";

// Everything the real module has and this one does not replace. A name a project imports and this
// file does not hand out would stop the import outright, and a name declared here wins over the
// one the star brings in.
export * from "node:fs/promises";

export const { readFile, writeFile, appendFile, readdir, mkdir, unlink, rm, rename, copyFile, stat, lstat, access } = promises;

export default promises;
