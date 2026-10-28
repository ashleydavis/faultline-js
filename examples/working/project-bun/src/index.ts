//
// The paths titles are served under, importing the slug file with no extension as Bun allows.
//

import assert from "node:assert/strict";
import { slugify } from "./slug";

//
// Gives the path each title is served under.
//
export function pathsFor(titles: string[]): string[] {
    assert(Array.isArray(titles));
    const paths: string[] = [];
    for (const title of titles) {
        paths.push(`/${slugify(title)}`);
    }
    assert(paths.length === titles.length);
    return paths;
}
