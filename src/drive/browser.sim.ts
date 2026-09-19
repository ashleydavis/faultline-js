// Scenarios for serving the work directory to a page.
//
// What a path is answered with turns on what is in the work directory, which is the run's own tree
// rather than a made up value. Starting the browser itself is not here: it needs a browser.

import fs from "node:fs";
import type { Checklist, Injector } from "faultline";
import { serveOne } from "./browser.ts";

// Every answer one path can get.
export function everyAnswerAPathGets(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const work = "/served";
    fs.writeFileSync(`${work}/held.mjs`, "export const a = 1;\n");
    fs.writeFileSync(`${work}/held.css`, "body { color: red }\n");
    fs.writeFileSync(`${work}/held.map`, "{}\n");
    fs.writeFileSync(`${work}/held.png`, "not really a picture");

    // The page itself.
    const page = serveOne(work, "/");
    if (page.status !== 200 || page.type !== "text/html") {
        throw new Error("ThePageItselfWasNotServed");
    }
    if (serveOne(work, undefined).status !== 200) {
        throw new Error("ARequestNamingNoPathWasNotGivenThePage");
    }

    // A file of each kind, which is served as what that kind is.
    for (const [name, type] of [["held.mjs", "text/javascript"], ["held.css", "text/css"], ["held.map", "application/json"]]) {
        const held = serveOne(work, `/${name!}`);
        if (held.status !== 200) {
            throw new Error(`TheFile_${name!}_WasNotServed`);
        }
        if (held.type !== type) {
            throw new Error(`TheFile_${name!}_WasServedAs_${String(held.type)}`);
        }
    }
    // A kind the server has no name for is served as bytes.
    if (serveOne(work, "/held.png").type !== "application/octet-stream") {
        throw new Error("AKindWithNoNameWasNotServedAsBytes");
    }
    // A query is taken off before the path is read, and a name written with an escape is read back.
    if (serveOne(work, "/held.mjs?v=2").status !== 200) {
        throw new Error("APathWithAQueryOnItWasNotServed");
    }
    fs.writeFileSync(`${work}/a name.mjs`, "export const a = 1;\n");
    if (serveOne(work, "/a%20name.mjs").status !== 200) {
        throw new Error("APathWrittenWithAnEscapeWasNotReadBack");
    }

    // A path that climbs out of the work directory is refused.
    if (serveOne(work, "/../../etc/passwd").status !== 403) {
        throw new Error("APathClimbingOutOfTheWorkDirectoryWasServed");
    }

    // A path that is not there at all. The run's own tree answers every read, so a read the
    // injector fails is what a file that is not there looks like from here.
    injector.fail("files", "missing");
    if (serveOne(work, "/never-written.mjs").status !== 404) {
        throw new Error("APathThatCannotBeReadWasServed");
    }
}
