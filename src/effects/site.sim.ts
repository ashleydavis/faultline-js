// Scenarios for where the code under test called an effect from.
//
// What this reads turns on the stack a runtime wrote, and a made up string is not one of those.

import type { Checklist, Injector } from "faultline";
import { callSite, placeIn, siteIn, withoutPrefix } from "./site.ts";

// Every way a runtime writes a frame.
export function everyShapeOfFrame(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (placeIn("    at readAll (/tmp/work/reads.ts:5:21)") !== "/tmp/work/reads.ts:5:21") {
        throw new Error("AFrameWithANameWasNotRead");
    }
    if (placeIn("    at /tmp/work/reads.ts:5:21") !== "/tmp/work/reads.ts:5:21") {
        throw new Error("AFrameWithNoNameWasNotRead");
    }
    if (placeIn("    at async /tmp/work/reads.ts:5:21") !== "/tmp/work/reads.ts:5:21") {
        throw new Error("AnAwaitedFrameWasNotRead");
    }
    if (placeIn("Error: site") !== undefined) {
        throw new Error("TheMessageWasReadAsAFrame");
    }
    placeIn("    at Object.<anonymous> (/tmp/a.ts:1:1)");
    placeIn("    at new Held (/tmp/a.ts:1:1)");
    placeIn("    at (unclosed");
}

// The first frame that is neither the runtime's own nor the tool's.
export function theFirstFrameThatIsTheCallers(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const stack = [
        "Error: site",
        "    at RunInjector.check (file:///tool/effects/injector.ts:139:51)",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)",
        "    at readAll (/tmp/work/reads.ts:6:21)",
    ].join("\n");
    if (siteIn(stack, "file:///tool/") !== "/tmp/work/reads.ts:6:21") {
        throw new Error("TheCallersOwnFrameWasNotFound");
    }
    if (siteIn("Error: site\n    at f (file:///tool/a.ts:1:1)", "file:///tool/") !== "") {
        throw new Error("AStackWithNoFrameOutsideTheToolNamedASite");
    }
    if (siteIn("", "file:///tool/") !== "") {
        throw new Error("AnEmptyStackNamedASite");
    }
    if (callSite().length === 0 && callSite("/nowhere").length === 0) {
        // A call made from inside the tool names no site, which is what this is.
        return;
    }
}

// The directory the copies sit in, taken off the front so a place is named by the path in the
// project rather than by a directory that is a different one every run.
export function theDirectoryTakenOffTheFront(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    if (withoutPrefix("/tmp/faultline-abc/reads.ts:6:21", "/tmp/faultline-abc") !== "reads.ts:6:21") {
        throw new Error("TheDirectoryWasNotTakenOff");
    }
    if (withoutPrefix("file:///tmp/faultline-abc/reads.ts:6:21", "/tmp/faultline-abc") !== "reads.ts:6:21") {
        throw new Error("TheDirectoryWasNotTakenOffAFileUrl");
    }
    if (withoutPrefix("/elsewhere/reads.ts:6:21", "/tmp/faultline-abc") !== "/elsewhere/reads.ts:6:21") {
        throw new Error("APlaceOutsideTheDirectoryWasChanged");
    }
    if (withoutPrefix("/tmp/reads.ts:6:21", "") !== "/tmp/reads.ts:6:21") {
        throw new Error("APlaceWasChangedWhenNoDirectoryWasNamed");
    }
    withoutPrefix("/tmp/faultline-abc/a.ts:1:1", "/tmp/faultline-abc/");
}
