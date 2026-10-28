//
// The replay token: everything needed to make one call again, as text a person can copy from a
// failure message into `--replay`, and the form in which the worker hands each call to its child.
//
// Written as `<file>:<function>;seed=<n>;values=<choices>;fail=<effect>#<occurrence>/<failure>`.
// A choice is a letter for where the value came from and its index, and several choices are
// separated by commas. A part with nothing in it is left out: `values` for a call with no
// parameters and `fail` for a call that injects no failure. A scenario's token names the sim file
// and the scenario, and carries no values.
//

import assert from "node:assert/strict";
import { readChoice, writeChoice, type Spec } from "../values/choices.ts";
import { failureGroups, isFailureOf, type Effect } from "../world/failures.ts";
import type { PlannedFailure } from "../world/injector.ts";
import { placeName } from "../world/places.ts";

//
// The largest seed a token carries: the generator keeps thirty two bits of state, so a larger seed
// would fold onto one already used.
//
export const largestSeed = 4294967295;

//
// One call, as a token names it.
//
export interface IReplayToken {
    //
    // The source file the function is in, or the sim file the scenario is in, relative to the
    // project root.
    //
    file: string;

    //
    // The function as the report labels it, or the scenario as its sim file exports it.
    //
    name: string;

    //
    // The seed the run's random numbers started from.
    //
    seed: number;

    //
    // The value chosen for each parameter, in parameter order.
    //
    values: Spec;

    //
    // The failure the call injects, or none.
    //
    failure: PlannedFailure | undefined;
}

//
// Why a token could not be read.
//
export interface ITokenError {
    //
    // Which part of the token is wrong.
    //
    name: "no-function" | "bad-part" | "bad-seed" | "bad-choice" | "bad-failure" | "unknown-effect" | "unknown-failure";

    //
    // A sentence for the person who typed the token, saying what is wrong with it.
    //
    message: string;
}

//
// A token that was read.
//
export interface ITokenRead {
    //
    // It was read.
    //
    ok: true;

    //
    // What it names.
    //
    value: IReplayToken;
}

//
// A token that could not be read.
//
export interface ITokenFailed {
    //
    // It was not read.
    //
    ok: false;

    //
    // Why.
    //
    error: ITokenError;
}

//
// What reading a token gives back.
//
export type TokenResult = ITokenRead | ITokenFailed;

//
// Writes a call as its token.
//
export function writeToken(token: IReplayToken): string {
    assert(token.file.length > 0);
    assert(token.name.length > 0);
    assert(Number.isInteger(token.seed) && token.seed >= 0 && token.seed <= largestSeed);
    const parts = [`${token.file}:${token.name}`, `seed=${token.seed}`];
    if (token.values.length > 0) {
        parts.push(`values=${token.values.map((choice) => writeChoice(choice)).join(",")}`);
    }
    if (token.failure !== undefined) {
        parts.push(`fail=${placeName(token.failure.place)}/${token.failure.failure}`);
    }
    return parts.join(";");
}

//
// Reads a token back into the call it names, or says which part of it is wrong.
//
export function readToken(text: string): TokenResult {
    const parts = text.trim().split(";");
    const named = parts[0]!;
    const colon = named.lastIndexOf(":");
    if (colon <= 0 || colon === named.length - 1) {
        return failedToken("no-function", `The token "${text}" does not start with the file and function it replays, written as <file>:<function>.`);
    }
    let seed: number | undefined;
    let values: Spec = [];
    let failure: PlannedFailure | undefined;
    for (const part of parts.slice(1)) {
        const equals = part.indexOf("=");
        const key = part.slice(0, equals);
        const value = part.slice(equals + 1);
        if (equals > 0 && key === "seed" && seed === undefined) {
            const read = readSeed(value);
            if (read === undefined) {
                return failedToken("bad-seed", `The seed "${value}" in the token is not a whole number from 0 to ${largestSeed}.`);
            }
            seed = read;
            continue;
        }
        if (equals > 0 && key === "values" && values.length === 0) {
            const read = readValues(value);
            if (read === undefined) {
                return failedToken("bad-choice", `The values "${value}" in the token are not choices such as b0 or s1, separated by commas.`);
            }
            values = read;
            continue;
        }
        if (equals > 0 && key === "fail" && failure === undefined) {
            const read = readFailure(value);
            if (!read.ok) {
                return read;
            }
            failure = read.value;
            continue;
        }
        return failedToken("bad-part", `The part "${part}" of the token is not seed=, values= or fail=, or it is there twice.`);
    }
    if (seed === undefined) {
        return failedToken("bad-seed", `The token "${text}" has no seed= part.`);
    }
    return {
        ok: true,
        value: {
            file: named.slice(0, colon),
            name: named.slice(colon + 1),
            seed,
            values,
            failure,
        },
    };
}

//
// The seed a token's text names, or undefined when it is not a whole number a seed can be.
//
export function readSeed(text: string): number | undefined {
    if (!/^(0|[1-9][0-9]*)$/.test(text)) {
        return undefined;
    }
    const seed = Number(text);
    if (seed > largestSeed) {
        return undefined;
    }
    return seed;
}

//
// The choices a token's `values` part names, or undefined when one of them is not a choice.
//
export function readValues(text: string): Spec | undefined {
    const values: Spec = [];
    for (const written of text.split(",")) {
        const choice = readChoice(written);
        if (choice === undefined) {
            return undefined;
        }
        values.push(choice);
    }
    return values;
}

//
// What reading a token's `fail` part gives back.
//
export interface IFailureRead {
    //
    // It was read.
    //
    ok: true;

    //
    // The failure it names.
    //
    value: PlannedFailure;
}

//
// The failure a token's `fail` part names, written `<effect>#<occurrence>/<failure>`.
//
export function readFailure(text: string): IFailureRead | ITokenFailed {
    const matched = /^([a-z-]+)#(0|[1-9][0-9]*)\/([a-z-]+)$/.exec(text);
    if (matched === null) {
        return failedToken("bad-failure", `The failure "${text}" in the token is not written as <effect>#<occurrence>/<failure>.`);
    }
    const effect = effectNamed(matched[1]!);
    if (effect === undefined) {
        return failedToken("unknown-effect", `The token names the effect "${matched[1]}", which FAILURES.md does not list.`);
    }
    const occurrence = Number(matched[2]);
    if (!Number.isSafeInteger(occurrence)) {
        return failedToken("bad-failure", `The occurrence "${matched[2]}" in the token is too large.`);
    }
    const failure = matched[3]!;
    if (!isFailureOf(effect, failure)) {
        return failedToken("unknown-failure", `The token names the failure "${failure}", which FAILURES.md does not list for ${effect}.`);
    }
    return {
        ok: true,
        value: {
            place: {
                effect,
                occurrence,
            },
            failure,
        },
    };
}

//
// The effect a token's text names, or undefined when the failure table has no group for it.
//
export function effectNamed(text: string): Effect | undefined {
    return failureGroups.find((group) => group.effect === text)?.effect;
}

//
// A token that could not be read, with the reason.
//
export function failedToken(name: ITokenError["name"], message: string): ITokenFailed {
    assert(message.endsWith("."));
    return {
        ok: false,
        error: {
            name,
            message,
        },
    };
}
