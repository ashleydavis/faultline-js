//
// The crashes earlier runs found, kept so that no run loses one.
//
// Each line of the file is the replay token of a call that crashed. Every run replays every token
// before it makes calls of its own, whatever its seed, and adds the token of every crash it finds.
// A token stays after its crash is fixed, so the crash is found again if it comes back. The file sits
// in Faultline's cache directory apart from the kept results, so `--no-cache` and `flt clear` leave
// it alone.
//

import assert from "node:assert/strict";
import path from "node:path";
import { cacheDirectoryOf } from "../lib/cache-directory.ts";
import { isCodedError, type IFileSystem } from "../lib/file-system.ts";
import { isFailedOpen, type IFailure } from "./judge.ts";
import { readToken, type IReplayToken } from "./token.ts";
import { placeName } from "../world/places.ts";
import { writeChoice } from "../values/choices.ts";

//
// The file the crashes of a project are kept in.
//
export function crashStorePath(projectRoot: string): string {
    assert(path.isAbsolute(projectRoot));
    const file = path.join(cacheDirectoryOf(projectRoot), "crashes.txt");
    assert(file.startsWith(projectRoot));
    return file;
}

//
// What reading the kept crashes gives back: the tokens, or a sentence saying why the file could not
// be read.
//
export interface ICrashesRead {
    //
    // The file was read, or there was none.
    //
    ok: true;

    //
    // The tokens in it, in the order they were added.
    //
    value: string[];
}

//
// Kept crashes that could not be read.
//
export interface ICrashesFailed {
    //
    // The file was not read.
    //
    ok: false;

    //
    // Why, as a sentence for the person running Faultline.
    //
    error: string;
}

//
// The kept crashes, or why they could not be read.
//
export type CrashesResult = ICrashesRead | ICrashesFailed;

//
// The tokens in the file at `file`, in the order they were added. A missing file holds none. Any
// other error is handed back, because a run that went on without its kept crashes would lose them.
//
export async function readCrashes(files: IFileSystem, file: string): Promise<CrashesResult> {
    assert(path.isAbsolute(file));
    let text: string;
    try {
        text = await files.readText(file);
    }
    catch (error) {
        if (isCodedError(error)) {
            if (error.code === "ENOENT") {
                return {
                    ok: true,
                    value: [],
                };
            }
        }
        return {
            ok: false,
            error: `Faultline could not read the kept crashes in ${file}: ${messageOf(error)}. Make the file readable, or delete it to throw the kept crashes away.`,
        };
    }
    const tokens = tokensOf(text);
    assert(tokens.every((token) => !token.includes("\n")));
    return {
        ok: true,
        value: tokens,
    };
}

//
// The message of something thrown: an error's own message, or the thing written out.
//
export function messageOf(thrown: unknown): string {
    if (thrown instanceof Error) {
        assert(typeof thrown.message === "string");
        return thrown.message;
    }
    const written = String(thrown);
    assert(typeof written === "string");
    return written;
}

//
// The tokens in `text`, one per line that is not blank, with the spaces around each taken off.
//
export function tokensOf(text: string): string[] {
    const lines = text.split("\n");
    const tokens: string[] = [];
    for (const line of lines) {
        const token = line.trim();
        if (token.length === 0) {
            continue;
        }
        tokens.push(token);
    }
    assert(tokens.length <= lines.length);
    assert(tokens.every((token) => token.length > 0));
    return tokens;
}

//
// `kept` followed by every token in `found` that names a call none of them already names, in the
// order found. A crash a run finds again with a new seed is not added a second time.
//
export function withNew(kept: string[], found: string[]): string[] {
    const tokens = [...kept];
    for (const token of found) {
        if (isAmong(tokens, token)) {
            continue;
        }
        tokens.push(token);
    }
    assert(tokens.length >= kept.length);
    assert(tokens.length <= kept.length + found.length);
    return tokens;
}

//
// Whether one of `tokens` names the same call as `token`.
//
export function isAmong(tokens: string[], token: string): boolean {
    assert(token.length > 0);
    assert(tokens.every((other) => other.length > 0));
    return tokens.some((other) => isSameCall(other, token));
}

//
// Whether two tokens name the same call. The seed is left out of the comparison unless a value was
// drawn from it (a seeded choice), because then the seed is what decides that value. A crash found
// again under another seed with the same values and failure is taken as the one already kept, and
// the kept token goes on reproducing it with its own seed. A token that cannot be read is the same
// call only as the same text.
//
export function isSameCall(left: string, right: string): boolean {
    assert(left.length > 0);
    assert(right.length > 0);
    if (left === right) {
        return true;
    }
    const first = readToken(left);
    const second = readToken(right);
    if (!first.ok) {
        return false;
    }
    if (!second.ok) {
        return false;
    }
    if (hasSeededValue(first.value)) {
        return false;
    }
    if (hasSeededValue(second.value)) {
        return false;
    }
    return callWithoutSeed(first.value) === callWithoutSeed(second.value);
}

//
// Whether a token carries a value drawn from its seed.
//
export function hasSeededValue(token: IReplayToken): boolean {
    assert(token.file.length > 0);
    assert(token.name.length > 0);
    return token.values.some((choice) => choice.source === "seeded");
}

//
// A token written without its seed, so two tokens that differ only in the seed read the same.
//
export function callWithoutSeed(token: IReplayToken): string {
    const values = token.values.map((choice) => writeChoice(choice)).join(",");
    const failure = token.failure === undefined ? "" : `${placeName(token.failure.place)}/${token.failure.failure}`;
    const call = [`${token.file}:${token.name}`, values, failure].join(";");
    assert(call.startsWith(`${token.file}:${token.name};`));
    assert(call.endsWith(`;${failure}`));
    return call;
}

//
// The tokens of the failures a run keeps: crashes and errors no code caught, which are the defects
// a new seed may not reach again. A call that never settled is found from the function alone and
// an expectation from the sim file, so neither needs keeping. A shard that
// failed to open is not kept either, because replaying it opens the file again and the next run
// opens it anyway.
//
export function crashTokens(failures: IFailure[]): string[] {
    const tokens = failures.filter((failure) => isCrashKept(failure)).map((failure) => failure.token);
    assert(tokens.length <= failures.length);
    assert(tokens.every((token) => token.length > 0));
    return tokens;
}

//
// Whether a run keeps the token of `failure`, for the reasons `crashTokens` gives.
//
export function isCrashKept(failure: IFailure): boolean {
    assert(failure.token.length > 0);
    if (isFailedOpen(failure)) {
        return false;
    }
    if (failure.kind === "crash") {
        return true;
    }
    return failure.kind === "uncaught";
}

//
// Writes `tokens` to the file at `file`, one per line, making the directory it is in.
//
export async function writeCrashes(files: IFileSystem, file: string, tokens: string[]): Promise<void> {
    assert(path.isAbsolute(file));
    assert(tokens.every((token) => token.length > 0));
    assert(tokens.every((token) => !token.includes("\n")));
    await files.makeDirectory(path.dirname(file));
    await files.writeText(file, tokens.map((token) => `${token}\n`).join(""));
}
