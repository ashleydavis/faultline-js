// Where the code under test called an effect from.
//
// A place an effect could fail has to be named by where it is. Named by how many times the effect
// had been called, a read inside a loop is ten places rather than one, and putting a branch ahead
// of a read renumbers every place after it.
//
// The stack of an error made inside the effect carries the call site. Node is run with
// `--enable-source-maps`, so it has already put the frame back on the line somebody wrote before it
// writes the stack out, and a browser reports the line of the copy it loaded.

// Where the tool's own files sit. A frame inside one of them is the tool on its way to the effect
// rather than the call site, so it is stepped over.
const toolDirectory = new URL("..", import.meta.url).href;

// Where the code under test called the effect it is now inside, written as the file, the line and
// the column. It is empty when the runtime gave no stack to read.
//
// `under` is where the copies of the project were put. It is taken off the front of the file, so a
// place is named by the path in the project rather than by a work directory that is a different one
// every run.
export function callSite(under = ""): string {
    return withoutPrefix(siteIn(new Error("site").stack ?? "", toolDirectory), under);
}

// One place with the directory the copies sit in taken off the front of it.
export function withoutPrefix(where: string, under: string): string {
    if (under === "") {
        return where;
    }
    for (const start of [under, `file://${under}`, new URL(`file://${under}`).href]) {
        const inside = start.endsWith("/") ? start : `${start}/`;
        if (where.startsWith(inside)) {
            return where.slice(inside.length);
        }
    }
    return where;
}

// The first frame of a stack that is neither the runtime's own nor inside `inside`, which is where
// the tool's files sit.
export function siteIn(stack: string, inside: string): string {
    for (const line of stack.split("\n")) {
        const where = placeIn(line);
        if (where === undefined || where.startsWith("node:") || where.startsWith(inside)) {
            continue;
        }
        return where;
    }
    return "";
}

// The file, line and column one frame of a stack names, or nothing when the line is not a frame.
//
// A frame reads "    at name (where)" when the runtime knows a name for it and "    at where" when
// it does not, so the part in brackets is taken when there is one.
export function placeIn(line: string): string | undefined {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) {
        return undefined;
    }
    const opened = trimmed.lastIndexOf("(");
    const closed = trimmed.lastIndexOf(")");
    const where = opened >= 0 && closed > opened ? trimmed.slice(opened + 1, closed) : trimmed.slice(3);
    return where.startsWith("async ") ? where.slice(6) : where;
}
