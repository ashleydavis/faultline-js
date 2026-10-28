//
// The lines a run prints, in the order it prints them: the files and functions read, the block per
// file `--full-report` asks for, the first failure with the command that repeats it, the checklist,
// the failure counts, the coverage line, what was exercised and what came from the cache, the time
// taken and the path of the report file. Each function gives its lines and prints nothing, so the
// run decides where they go and a test reads them.
//

import assert from "node:assert/strict";
import path from "node:path";
import { isSimFile } from "../discover/sources.ts";
import { callsPerSpecMost, type IShardResult } from "../run/explore.ts";
import type { FailureKind, IFailure } from "../run/judge.ts";
import { readToken } from "../run/token.ts";
import { messageLines } from "./crash-view.ts";
import { elapsed, padded, percentageOf, plural, runTimeText } from "./style.ts";

//
// What a run's code paths came to.
//
export interface ICoverageCounts {
    //
    // How many code paths of the run's source files some call exercised.
    //
    ticked: number;

    //
    // How many code paths the run's source files have that a count can prove ran.
    //
    total: number;

    //
    // How many functions had at least one code path exercised.
    //
    functions: number;

    //
    // How many source files had at least one code path exercised.
    //
    files: number;
}

//
// The first line of a run, naming the project by its directory.
//
export function headerLine(projectRoot: string): string {
    assert(path.isAbsolute(projectRoot));
    const name = path.basename(projectRoot);
    assert(name.length > 0);
    return `Fault testing the JavaScript and TypeScript source in ${name}.`;
}

//
// The line that says how many source files and functions the run read. Every file's top level
// counts as a function, because importing the file runs it.
//
export function readCountLines(shards: IShardResult[]): string[] {
    const sources = shards.filter((shard) => !isSimFile(shard.facts.file));
    const functions = sources.reduce((count, shard) => count + shard.facts.functions.length, 0);
    assert(functions >= 0);
    return ["", `  Read ${sources.length} source ${plural(sources.length, "file", "files")}, ${functions} ${plural(functions, "function", "functions")}.`];
}

//
// The lines of each problem with what the run loaded: a sim file with an error or that failed to
// load, and a source file that failed to load, so a problem never hides behind a lower percentage.
// A problem that carries an error's message can run over several lines, and each is printed on a
// line of its own.
//
export function problemLines(shards: IShardResult[]): string[] {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const shard of shards) {
        const problems = [...shard.facts.simProblems];
        if (shard.facts.loadProblem) {
            problems.push(shard.facts.loadProblem);
        }
        for (const problem of problems) {
            if (seen.has(problem)) {
                continue;
            }
            seen.add(problem);
            lines.push(...messageLines(problem).map((line) => `  ${line}`));
        }
    }
    assert(lines.length >= seen.size);
    assert(lines.every((line) => !line.includes("\n")));
    return lines;
}

//
// The block per source file `--full-report` asks for: a line per function saying whether every
// one of its code paths was exercised, how many and how many calls were made. `keys.exercised`
// holds the keys of the code paths some call exercised and `keys.cached` names the files whose
// results came from the cache, which their headings say.
//
export function fullReportLines(shards: IShardResult[], keys: { exercised: Set<string>; cached: Set<string> }): string[] {
    const exercised = keys.exercised;
    const cached = keys.cached;
    assert([...cached].every((file) => shards.some((shard) => shard.facts.file === file)), "A file came from the cache that the run does not have.");
    const lines = ["", "Fault testing"];
    for (const shard of shards) {
        const facts = shard.facts;
        if (isSimFile(facts.file)) {
            continue;
        }
        assert(facts.paths.every((record) => record.file === facts.file));
        lines.push("", cached.has(facts.file) ? `  ${facts.file} (from the cache)` : `  ${facts.file}`);
        for (const plan of facts.functions) {
            const paths = facts.paths.filter((record) => record.fn === plan.label);
            const ticked = paths.filter((record) => exercised.has(record.key)).length;
            const isDone = ticked === paths.length;
            const tally = shard.tallies.find((one) => one.name === plan.label && one.line === plan.line);
            const calls = tally ? tally.calls : 0;
            const mark = isDone ? "ok  " : "MISS";
            const counts = `${ticked}/${paths.length} code paths`;
            if (calls > 0) {
                lines.push(`    ${mark} ${padded(plan.label, 33)}${counts}, ${calls} ${plural(calls, "call", "calls")}`);
                continue;
            }
            lines.push(`    ${mark} ${padded(plan.label, 33)}${isDone ? counts : `${counts}, never called`}`);
        }
    }
    return lines;
}

//
// The command that repeats the call a replay token names.
//
export function replayLine(token: string): string {
    assert(token.length > 0);
    assert(!token.includes("\""));
    return `Reproduce it with: npx flt --replay "${token}"`;
}

//
// The lines of the first failure: a blank line, its view and the command that repeats it. How many
// more there are is said by the failure counts.
//
export function firstFailureLines(failure: IFailure, view: string[]): string[] {
    assert(view.length > 0);
    return ["", ...view, replayLine(failure.token)];
}

//
// One line per function or scenario whose calls for one set of values reached the limit on calls
// with places still untried, because the contract says a limit that cuts anything short is printed.
//
export function cutShortLines(shards: IShardResult[]): string[] {
    const lines: string[] = [];
    for (const shard of shards) {
        for (const tally of shard.tallies) {
            if (tally.cutShort) {
                assert(tally.calls >= callsPerSpecMost, `${tally.name} was cut short after ${tally.calls} calls, fewer than the limit.`);
                lines.push(`  Faultline stopped injecting failures into ${tally.name} at ${shard.facts.file}:${tally.line} after ${callsPerSpecMost} calls with one set of values, so some places it reached were not tried.`);
            }
        }
    }
    return lines.length === 0 ? [] : ["", ...lines];
}

//
// How each kind of failure is counted, in the order the counts are printed.
//
export interface IKindWords {
    //
    // The kind.
    //
    kind: FailureKind;

    //
    // What one of them did.
    //
    one: string;

    //
    // What several of them did.
    //
    many: string;
}

//
// The words of each kind of failure, in the order the counts are printed.
//
export const kindWords: IKindWords[] = [
    {
        kind: "crash",
        one: "call crashed",
        many: "calls crashed",
    },
    {
        kind: "uncaught",
        one: "call left an error that no code caught",
        many: "calls left an error that no code caught",
    },
    {
        kind: "hang",
        one: "call did not return in time",
        many: "calls did not return in time",
    },
    {
        kind: "expectation",
        one: "expectation was false",
        many: "expectations were false",
    },
];

//
// The lines that count the failures kind by kind, with how many functions and scenarios they were
// in, or one line saying none was found.
//
export function failureCountLines(failures: IFailure[]): string[] {
    if (failures.length === 0) {
        return ["", "  No call crashed, hung or found an expectation false."];
    }
    const lines = [""];
    for (const words of kindWords) {
        const ofKind = failures.filter((failure) => failure.kind === words.kind);
        if (ofKind.length === 0) {
            continue;
        }
        const subjects = new Set(ofKind.map((failure) => subjectKey(failure.token)));
        const scenarios = [...subjects].filter((key) => isSimFile(key.split("\t")[0]!)).length;
        const functions = subjects.size - scenarios;
        const places: string[] = [];
        if (functions > 0) {
            places.push(`${functions} ${plural(functions, "function", "functions")}`);
        }
        if (scenarios > 0) {
            places.push(`${scenarios} ${plural(scenarios, "scenario", "scenarios")}`);
        }
        lines.push(`  ${ofKind.length} ${ofKind.length === 1 ? words.one : words.many}, in ${places.join(" and ")}.`);
    }
    assert(lines.length > 1);
    return lines;
}

//
// What a failure's token names: its file and its function or scenario, joined by a tab. A token
// that cannot be read is its own subject.
//
export function subjectKey(token: string): string {
    assert(token.length > 0);
    const read = readToken(token);
    if (!read.ok) {
        return token;
    }
    return `${read.value.file}\t${read.value.name}`;
}

//
// What the run's code paths came to: how many of the source files' code paths in `shards` were
// exercised, of how many, and in how many functions and files.
//
export function coverageCounts(shards: IShardResult[], exercised: Set<string>): ICoverageCounts {
    const counts: ICoverageCounts = {
        ticked: 0,
        total: 0,
        functions: 0,
        files: 0,
    };
    for (const shard of shards) {
        const ticked = shard.facts.paths.filter((record) => exercised.has(record.key));
        counts.total += shard.facts.paths.length;
        counts.ticked += ticked.length;
        counts.functions += new Set(ticked.map((record) => record.fn)).size;
        if (ticked.length > 0) {
            counts.files += 1;
        }
    }
    assert(counts.ticked <= counts.total);
    return counts;
}

//
// The one number a run ends on, between blank lines: how many of the code paths it can observe
// were exercised.
//
export function coverageLines(counts: ICoverageCounts): string[] {
    assert(counts.ticked >= 0);
    assert(counts.ticked <= counts.total);
    return ["", `  Coverage: ${counts.ticked} of ${counts.total} code paths, ${percentageOf(counts.ticked, counts.total)}%.`, ""];
}

//
// The line that says how much the run exercised.
//
export function exercisedLine(counts: ICoverageCounts): string {
    assert(counts.functions <= counts.ticked);
    return `  Exercised ${counts.ticked} code ${plural(counts.ticked, "path", "paths")}, ${counts.functions} ${plural(counts.functions, "function", "functions")}, ${counts.files} ${plural(counts.files, "file", "files")}.`;
}

//
// The line that says how many files' results came from the cache, or none when none did.
//
export function cachedLines(cached: Set<string>): string[] {
    if (cached.size === 0) {
        return [];
    }
    const sims = [...cached].filter((file) => isSimFile(file)).length;
    const sources = cached.size - sims;
    assert(sources >= 0);
    return [`  Cached ${sources} source ${plural(sources, "file", "files")}, ${sims} sim ${plural(sims, "file", "files")}.`];
}

//
// The line that says how long the run took.
//
export function tookLine(milliseconds: number): string {
    assert(milliseconds >= 0, "A run cannot end before it starts.");
    return `  Took ${runTimeText(milliseconds)}.`;
}

//
// The lines that name the report file, the one place its path is printed.
//
export function reportPathLines(reportPath: string): string[] {
    assert(reportPath.length > 0);
    return ["", `  Every failure and every thing to do is in ${reportPath}.`];
}

//
// The line that says where a run has got to, which a terminal shows in place of the one before.
//
export function progressLine(at: { calls: number; elapsedMs: number; file: string; name: string }): string {
    assert(at.calls > 0);
    assert(at.elapsedMs >= 0);
    return `  Exercised ${at.calls} ${plural(at.calls, "call", "calls")} in ${elapsed(at.elapsedMs)}, now in ${at.file} ${at.name}.`;
}

//
// What a run exits with: 0 when every code path was exercised, no call failed and every file
// loaded, and 1 otherwise. A file that did not parse or load has code paths no count holds, so a
// problem with what the run loaded is never hidden behind a percentage of 100.
//
export function exitCodeOf(counts: ICoverageCounts, failures: IFailure[], problems: string[]): number {
    if (failures.length > 0) {
        return 1;
    }
    if (problems.length > 0) {
        return 1;
    }
    if (counts.ticked < counts.total) {
        return 1;
    }
    assert.equal(counts.ticked, counts.total);
    return 0;
}
