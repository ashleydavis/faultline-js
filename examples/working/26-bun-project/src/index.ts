import { slugify } from "./slug.ts";

// Turns a list of titles into the paths they are served under.
export function pathsFor(titles: string[]): string[] {
    const out: string[] = [];
    for (const title of titles) {
        out.push(`/${slugify(title)}`);
    }
    return out;
}
