// What the copy imports in place of `node:fs/promises`. It is the promise half of the replaced
// `node:fs`, so a project that uses both reads and writes one tree.

import { promises } from "./fs.ts";

// Everything the real module has and this one does not replace: its constants. Every call that
// reaches the disk is declared below, and a name declared here wins over the one the star brings in.
export * from "node:fs/promises";

export const {
    access, appendFile, chmod, chown, copyFile, cp, glob, lchmod, lchown, link, lstat, lutimes, mkdir, mkdtemp,
    mkdtempDisposable, open, opendir, readFile, readdir, readlink, realpath, rename, rm, rmdir, stat, statfs,
    symlink, truncate, unlink, utimes, watch, writeFile, constants,
} = promises;

export default promises;
