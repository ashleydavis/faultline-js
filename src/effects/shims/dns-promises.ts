// What the copy imports in place of `node:dns/promises`. It is the promise half of the replaced
// `node:dns`, so a project that uses both fails the same way in each.

import { promises } from "./dns.ts";

// Everything the real module has and this one does not replace. A name a project imports and this
// file does not hand out would stop the import outright, and a name declared here wins over the
// one the star brings in.
export * from "node:dns/promises";

export const { lookup, resolve, resolve4 } = promises;

export default promises;
