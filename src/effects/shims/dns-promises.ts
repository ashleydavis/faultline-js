// What the copy imports in place of `node:dns/promises`. It is the promise half of the replaced
// `node:dns`, so a project that uses both fails the same way in each.

import { promises } from "./dns.ts";

export const { lookup, resolve, resolve4 } = promises;

export default promises;
