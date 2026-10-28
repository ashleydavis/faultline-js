// Reads what a sim file offers a run: its value factories, scenarios and expectation functions, and
// any type errors in it. Also says which sim files a source file's functions use: the one beside it
// and every `global.sim.ts`.
//
// A value factory is found by the type it returns, a scenario by a first parameter of type
// `ScenarioContext` and an expectation function by a first parameter of type `ExpectationContext`,
// both from the `faultline` package. None is ever found by its name.

import assert from "node:assert/strict";
import ts from "typescript";
import { readFile, type FunctionInfo, type ParameterInfo } from "./functions.ts";
import { formatDiagnostic } from "./program.ts";
import type { RecipeContext } from "./recipes.ts";
import { isSimFile, simFileFor, type FoundFile, type Walked } from "./sources.ts";

// One value factory, which is a function in a sim file returning a type the run cannot build
// from its own type.
export interface FactoryInfo {
    // The key of the type it returns.
    key: string;

    // The type's name, as the report prints it.
    typeName: string;

    // The sim file it is written in.
    file: string;

    // The name the sim file exports it under.
    exportName: string;

    // The method to call, when the factory is a method on a class rather than a plain function.
    method?: string;

    // The parameters the factory itself takes, which the run fills like any others.
    parameters: ParameterInfo[];

    // The class's own constructor parameters, when the factory is a method on a class.
    ownerParameters?: ParameterInfo[];
}

// One expectation function: a function in a sim file whose first parameter is an expectation
// context.
export interface ExpectationInfo {
    // The sim file it is written in.
    file: string;

    // The name the sim file exports it under.
    exportName: string;

    // The line it starts on, counting from one.
    line: number;
}

// One scenario, which is a function in a sim file whose first parameter is a scenario context.
export interface ScenarioInfo {
    // The sim file it is written in.
    file: string;

    // The name the sim file exports it under.
    exportName: string;

    // The line it starts on, counting from one.
    line: number;
}

// Everything read out of one sim file.
export interface SimFacts {
    // The sim file, relative to the root of the run.
    file: string;

    // The value factories in it.
    factories: FactoryInfo[];

    // The scenarios in it.
    scenarios: ScenarioInfo[];

    // The expectation functions in it.
    expectations: ExpectationInfo[];

    // Every error the compiler finds in it, written with the file, line and column. A sim file that
    // does not type-check is reported rather than skipped, because a factory or scenario in it that
    // quietly went missing would turn into checklist items the person already wrote.
    typeErrors: string[];
}

// Reads one sim file. `file` is the path the report prints and `program` is the program that read
// it, which its type errors come from.
export function readSim(context: RecipeContext, program: ts.Program, source: ts.SourceFile, file: string): SimFacts {
    assert.ok(isSimFile(file), `${file} is not a sim file.`);
    const facts = readFile(context, source, file);
    const factories: FactoryInfo[] = [];
    const scenarios: ScenarioInfo[] = [];
    const expectations: ExpectationInfo[] = [];
    for (const one of facts.functions) {
        // A sim file keeps helpers of its own. They are not what the file offers the run: a value
        // factory, a scenario and an expectation function are what the file itself exports.
        if (one.reach.how !== "export") {
            continue;
        }
        const kind = contextKindOf(one);
        if (kind === "scenario") {
            scenarios.push({ file, exportName: one.reach.name, line: one.line });
            continue;
        }
        if (kind === "expectation") {
            expectations.push({ file, exportName: one.reach.name, line: one.line });
            continue;
        }
        if (one.returnKey !== undefined) {
            factories.push({
                key: one.returnKey.key,
                typeName: one.returnKey.name,
                file,
                exportName: one.reach.name,
                parameters: one.parameters,
            });
        }
    }
    // The factories written as methods on an exported class, which is how one factory hands back a
    // different value on every call.
    for (const owner of facts.classes) {
        if (owner.exportName === "") {
            continue;
        }
        for (const one of facts.functions) {
            if (one.reach.how !== "method" || one.reach.className !== owner.name || one.reach.onClass) {
                continue;
            }
            if (one.returnKey === undefined || contextKindOf(one) !== undefined) {
                continue;
            }
            factories.push({
                key: one.returnKey.key,
                typeName: one.returnKey.name,
                file,
                exportName: owner.exportName,
                method: one.reach.name,
                parameters: one.parameters,
                ownerParameters: owner.parameters,
            });
        }
    }
    return { file, factories, scenarios, expectations, typeErrors: typeErrorsIn(program, source, context.root) };
}

// Whether a function's first parameter is a scenario context or an expectation context, which is
// what makes it a scenario or an expectation function. It is undefined for any other function.
export function contextKindOf(info: FunctionInfo): "scenario" | "expectation" | undefined {
    const first = info.parameters[0];
    if (first === undefined || first.recipe.kind !== "effect") {
        return undefined;
    }
    if (first.recipe.effect === "scenario") {
        return "scenario";
    }
    if (first.recipe.effect === "expectation") {
        return "expectation";
    }
    return undefined;
}

// Every error the compiler finds in one file: the ones that stop it parsing and the type errors.
export function typeErrorsIn(program: ts.Program, source: ts.SourceFile, root: string): string[] {
    const found = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
    return found.map((diagnostic) => formatDiagnostic(diagnostic, root));
}

// The sim files whose value factories and expectation functions a source file's functions use,
// relative to the root: the sim file beside it first, then every `global.sim.ts` in the order they
// sort.
export function simFilesFor(source: FoundFile, walked: Walked): string[] {
    assert.ok(!isSimFile(source.file));
    const used: string[] = [];
    if (source.sim !== undefined) {
        const beside = simFileFor(source.file);
        assert.equal(walked.sims.get(beside), source.sim);
        used.push(beside);
    }
    for (const global of walked.globalSims) {
        if (!used.includes(global)) {
            used.push(global);
        }
    }
    return used;
}
