//
// Reads one shard with the TypeScript compiler: the functions of a source file and the conditions
// in each, or the scenarios of a sim file, and what the shard's sim files offer.
//
// The child reads each shard it is given with a program over the shard's file and its sim files.
// The program it built for the previous shard under the same `tsconfig.json` is handed to the
// compiler as the old one, so files the two share are not parsed again.
//

import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { conditionsIn, type Condition } from "../discover/conditions.ts";
import { readFile, topLevelLabel, type FileFacts, type FunctionInfo } from "../discover/functions.ts";
import { functionLabel, isReportedFunction } from "../discover/names.ts";
import { augmentingFiles, createCompilerHost, formatDiagnostic, readCompilerOptions, ownerConfig } from "../discover/program.ts";
import type { RecipeContext } from "../discover/recipes.ts";
import { readSim, type SimFacts } from "../discover/sim.ts";
import { isSimFile } from "../discover/sources.ts";
import { untilKnown, type IReading } from "../lib/known-files.ts";

//
// What reading one shard gives.
//
export interface IShardReading {
    //
    // The functions of a source file, or undefined for a sim file.
    //
    facts: FileFacts | undefined;

    //
    // What each of the shard's sim files offers, in the order the open request named them. For a
    // sim file shard it is the sim file itself.
    //
    sims: SimFacts[];

    //
    // The conditions in each function of a source file, by `functionKey`.
    //
    conditions: Map<string, Condition[]>;

    //
    // What the compiler said about each place the source file does not parse, with the file, line
    // and column. A file that does not parse is not loaded, because transpiling it gives code the
    // file never said. Empty for a sim file, whose errors are in its own facts.
    //
    parseErrors: string[];
}

//
// The programs a child built, by the `tsconfig.json` each was built with, or by the empty string
// for files no `tsconfig.json` owns. Each is the old program for the next shard it owns.
//
export type ProgramsByConfig = Map<string, ts.Program>;

//
// The most syntax nodes `conditionsByFunction` visits in one file. A file with more than this is
// beyond what any source file a person writes holds, so reaching it means the walk is going round,
// and failing loudly beats a walk that never ends.
//
export const syntaxNodesMost = 100000000;

//
// Reads the shard `file` with its sim files `sims`, both relative to the project root, through
// `reading`, which every file the compiler follows is read ahead into.
//
export async function readShard(reading: IReading, projectRoot: string, simTypes: string[], file: string, sims: string[], programs: ProgramsByConfig): Promise<IShardReading> {
    assert(path.isAbsolute(projectRoot));
    assert(!path.isAbsolute(file), `${file} is not relative to the project root.`);
    const full = path.join(projectRoot, file);
    const simFull = sims.map((sim) => path.join(projectRoot, sim));
    const config = await ownerConfig(reading.fileSystem, projectRoot, full);
    const key = config ?? "";
    const shardNames = isSimFile(file) ? simFull : [full, ...simFull];
    const augmenting = config ? await untilKnown(reading, () => augmentingFiles(reading.known, config)) : [];
    const rootNames = [...shardNames, ...augmenting.filter((augmentingFile) => !shardNames.includes(augmentingFile))];
    const options = await readCompilerOptions(reading, config);
    const program = await untilKnown(reading, () => ts.createProgram({
        rootNames,
        options,
        host: createCompilerHost(reading.known),
        oldProgram: programs.get(key),
    }));
    programs.set(key, program);
    assert.equal(programs.get(key), program);
    const context: RecipeContext = {
        checker: program.getTypeChecker(),
        simTypesFile: simTypes,
        root: projectRoot,
    };
    const readSims = sims.map((sim) => readSim(context, program, sourceOf(program, path.join(projectRoot, sim)), sim));
    if (isSimFile(file)) {
        return {
            facts: undefined,
            sims: readSims,
            conditions: new Map(),
            parseErrors: [],
        };
    }
    const source = sourceOf(program, full);
    return {
        facts: readFile(context, source, file),
        sims: readSims,
        conditions: conditionsByFunction(context.checker, source),
        parseErrors: program.getSyntacticDiagnostics(source).map((diagnostic) => formatDiagnostic(diagnostic, projectRoot)),
    };
}

//
// The parsed file a program read at `full`. Every file asked for is a root of the program, so the
// program has it.
//
export function sourceOf(program: ts.Program, full: string): ts.SourceFile {
    assert(path.isAbsolute(full));
    const source = program.getSourceFile(full);
    assert(source !== undefined, `The program has no file ${full}.`);
    return source;
}

//
// The key a function's conditions are kept under: its label and line, because two functions can
// share a label.
//
export function functionKey(label: string, line: number): string {
    assert(label.length > 0);
    assert(Number.isInteger(line));
    assert(line >= 1);
    return `${label}@${line}`;
}

//
// The conditions in every function of a file the report lists, and in the file's top level, in the
// order the functions are written, which is the order the report lists them in.
//
export function conditionsByFunction(checker: ts.TypeChecker, source: ts.SourceFile): Map<string, Condition[]> {
    const found = new Map<string, Condition[]>();
    found.set(functionKey(topLevelLabel, 1), conditionsIn(checker, source));
    const stack: ts.Node[] = [source];
    for (let visited = 0; stack.length > 0; visited += 1) {
        assert(visited < syntaxNodesMost, "A file had more syntax nodes than any source file holds, which is a defect in Faultline.");
        const node = stack.pop();
        assert(node !== undefined);
        if (isReportedFunction(node)) {
            const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
            found.set(functionKey(functionLabel(node), line), conditionsIn(checker, node));
        }
        stack.push(...childrenOf(node).reverse());
    }
    assert(found.has(functionKey(topLevelLabel, 1)));
    return found;
}

//
// The children of a syntax node, in the order they are written.
//
export function childrenOf(node: ts.Node): ts.Node[] {
    const children: ts.Node[] = [];
    //
    // `forEachChild` stops at the first callback that returns something truthy, so the callback
    // returns nothing and every child is collected.
    //
    ts.forEachChild(node, (child) => {
        children.push(child);
    });
    assert(children.every((child) => child.pos >= node.pos));
    assert(children.every((child) => child.end <= node.end));
    return children;
}

//
// The labels of the functions whose code paths a function has to see exercised before Faultline
// stops calling it: its own, and those of every function Faultline cannot call that is reached
// only through it, or through no function in particular.
//
// A function Faultline cannot call is reached through the nearest function around it that
// Faultline can call. One with no such function around it (an abstract class's method, say) can be
// reached from anywhere in the file, so every function waits for it.
//
export function targetLabels(functions: FunctionInfo[], label: string): string[] {
    assert(label.length > 0);
    const byLabel = new Map<string, FunctionInfo>();
    for (const written of functions) {
        if (!byLabel.has(written.label)) {
            byLabel.set(written.label, written);
        }
    }
    const labels = [label];
    for (const written of functions) {
        if (written.reach.how !== "inside") {
            continue;
        }
        if (written.label === label) {
            continue;
        }
        const reacher = reachingFunction(byLabel, written);
        if (reacher === undefined) {
            labels.push(written.label);
        }
        else {
            if (reacher === label) {
                labels.push(written.label);
            }
        }
    }
    assert.equal(labels[0], label);
    assert(labels.length <= functions.length + 1);
    return labels;
}

//
// The label of the nearest function around `inside` that Faultline can call, or undefined when no
// function it can call is around it. Each step moves out by one function and never to a label it
// has seen, so the walk takes at most one step per function of the file.
//
export function reachingFunction(byLabel: Map<string, FunctionInfo>, inside: FunctionInfo): string | undefined {
    assert.equal(inside.reach.how, "inside");
    const seen = new Set<string>();
    let around = inside.within;
    for (let step = 0; around !== undefined; step += 1) {
        assert(step <= byLabel.size, "The walk out of a function took more steps than the file has functions.");
        if (seen.has(around)) {
            return undefined;
        }
        seen.add(around);
        const found = byLabel.get(around);
        if (found === undefined) {
            return undefined;
        }
        if (found.reach.how !== "inside") {
            return around;
        }
        around = found.within;
    }
    return undefined;
}
