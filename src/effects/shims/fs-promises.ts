// What the copy imports in place of `node:fs/promises`. It is the promise half of the replaced
// `node:fs`, so a project that uses both reads and writes one tree.

import { promises } from "./fs.ts";

export const { readFile, writeFile, appendFile, readdir, mkdir, unlink, rm, rename, copyFile, stat, lstat, access } = promises;

export default promises;
