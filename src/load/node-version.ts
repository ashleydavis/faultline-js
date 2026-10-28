//
// Decides whether the runtime `flt` was started in can run Faultline, and says why not when it
// cannot.
//
// Coverage is read from V8 and the project is loaded through `module.register`, so Faultline
// needs Node at the version `engines.node` in its own `package.json` names. The check runs before
// anything else, so an older Node gets one sentence instead of an error from deep inside a run.
//

import assert from "node:assert/strict";
import type { IFileSystem } from "../lib/file-system.ts";

//
// A version as three numbers.
//
export interface IVersion {
    //
    // The major number.
    //
    major: number;

    //
    // The minor number.
    //
    minor: number;

    //
    // The patch number.
    //
    patch: number;
}

//
// What the running process says it is, read from `process.versions`.
//
export interface IRuntimeVersions {
    //
    // The version of Node, or of the Node a runtime that is not Node says it matches.
    //
    node: string;

    //
    // The version of Bun when the runtime is Bun, which reports a Node version of its own but has
    // no V8 to read coverage from.
    //
    bun: string | undefined;
}

//
// The sentence Faultline prints before it exits 1 when the runtime cannot run it, or nothing when
// it can. `required` is `engines.node` from Faultline's own `package.json`.
//
export function nodeVersionRefusal(versions: IRuntimeVersions, required: string): string | undefined {
    assert(required.length > 0);
    assert(versions.node.length > 0);
    const minimum = minimumVersion(required);
    const wanted = `Faultline needs Node ${writeVersion(minimum)} or later`;
    if (versions.bun) {
        return `${wanted} and this is Bun ${versions.bun}, so start \`flt\` with Node.`;
    }
    const running = parseVersion(versions.node);
    if (isOlder(running, minimum)) {
        return `${wanted} and this is Node ${writeVersion(running)}, so install Node ${minimum.major} or later and run it again.`;
    }
    return undefined;
}

//
// `engines.node` from a `package.json`, which is Faultline's own, so a file without it is a broken
// install of Faultline rather than something the person running it can fix.
//
export async function readRequiredNode(fileSystem: IFileSystem, packageFile: string): Promise<string> {
    const read: unknown = JSON.parse(await fileSystem.readText(packageFile));
    assert(typeof read === "object");
    assert(read);
    assert("engines" in read);
    const engines = read.engines;
    assert(typeof engines === "object");
    assert(engines);
    assert("node" in engines);
    assert(typeof engines.node === "string");
    return engines.node;
}

//
// The lowest version a range allows. Faultline's own `package.json` writes its range as `>=` and a
// version, so any other range is a mistake in Faultline.
//
export function minimumVersion(range: string): IVersion {
    assert(range.startsWith(">="), `engines.node is ${range}, which is not written as >= and a version.`);
    return parseVersion(range.slice(2));
}

//
// A version written as three numbers, with or without the `v` Node puts in front of its own.
//
export function parseVersion(text: string): IVersion {
    const parts = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
    assert(parts !== null, `${text} is not a version written as three numbers.`);
    const version: IVersion = {
        major: Number(parts[1]),
        minor: Number(parts[2]),
        patch: Number(parts[3]),
    };
    assert(isWholeVersion(version));
    return version;
}

//
// Whether every number of a version is a whole number that is not negative, which is all a
// version can be once its text has been read.
//
export function isWholeVersion(version: IVersion): boolean {
    if (!Number.isSafeInteger(version.major)) {
        return false;
    }
    if (!Number.isSafeInteger(version.minor)) {
        return false;
    }
    if (!Number.isSafeInteger(version.patch)) {
        return false;
    }
    if (version.major < 0) {
        return false;
    }
    if (version.minor < 0) {
        return false;
    }
    return version.patch >= 0;
}

//
// Whether `running` comes before `minimum`.
//
export function isOlder(running: IVersion, minimum: IVersion): boolean {
    assert(isWholeVersion(running));
    assert(isWholeVersion(minimum));
    if (running.major !== minimum.major) {
        return running.major < minimum.major;
    }
    if (running.minor !== minimum.minor) {
        return running.minor < minimum.minor;
    }
    return running.patch < minimum.patch;
}

//
// A version as Node writes one, without the `v`.
//
export function writeVersion(version: IVersion): string {
    assert(isWholeVersion(version));
    return `${version.major}.${version.minor}.${version.patch}`;
}
