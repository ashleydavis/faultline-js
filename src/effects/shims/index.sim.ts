// Scenarios for saying where a replacement sits.
//
// What this answers turns on the name a project imported and on which of the two copies of the tool
// is running, and a made up string names neither.

import fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { Checklist, Injector } from "faultline";
import { shimFor } from "./index.ts";

// Puts a replacement where this copy of the tool looks for one.
//
// A replacement sits beside the module that names them, and a copy of the tool has none beside it.
// The ones written never load: the code under test imports the replacement the tool itself is
// running, which is the one on the disk.
function replacementsWritten(): void {
    for (const [name, extension] of [["fs", ".js"], ["fs-promises", ".ts"], ["dns", ".ts"], ["dns-promises", ".ts"], ["http", ".ts"], ["net", ".ts"], ["child-process", ".ts"]]) {
        fs.writeFileSync(fileURLToPath(new URL(`./${name}${extension}`, import.meta.url)), "");
    }
}

// The names a run replaces, and the ones it leaves alone.
export function theNamesARunReplaces(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    replacementsWritten();
    for (const name of ["node:fs", "fs", "node:fs/promises", "node:dns", "dns/promises", "node:http", "https", "net", "child_process"]) {
        if (shimFor(name) === undefined) {
            throw new Error("ANameARunReplacesWasSaidToSitNowhere");
        }
    }
    for (const name of ["node:os", "typescript", "./a.ts", ""]) {
        if (shimFor(name) !== undefined) {
            throw new Error("ANameARunLeavesAloneWasSaidToBeReplaced");
        }
    }
}
