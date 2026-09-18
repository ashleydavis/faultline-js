// Reads every function a run exercises, with the recipe for each parameter, and reads the test
// input factories and scenarios a sim file holds.

import ts from "typescript";
import { exportedAs } from "../build/emit.ts";
import { functionLabel, isReportedFunction, type FunctionNode } from "./names.ts";
import { recipeFor, typeKeyOf, type Recipe, type RecipeContext } from "./recipes.ts";
import { toPosix } from "./sources.ts";

// One parameter of a function, and how to build values for it.
export interface ParameterInfo {
    // What the parameter is called, as the report prints it.
    name: string;

    // How to build a value for it.
    recipe: Recipe;

    // Whether a call may leave it out.
    optional: boolean;

    // Whether it takes everything left, as `...rest` does.
    rest: boolean;
}

// How the driver gets hold of a function.
export type Reach =
    | { how: "export"; name: string }
    | { how: "method"; className: string; classExport: string; name: string; onClass: boolean; accessor: "none" | "get" | "set" }
    | { how: "inside"; because: string };

// One function a run reports.
export interface FunctionInfo {
    // What the report calls it.
    label: string;

    // The file it is written in, relative to the root of the run.
    file: string;

    // The line it starts on, counting from one.
    line: number;

    // How the driver reaches it, or why it cannot.
    reach: Reach;

    // Its parameters, in order.
    parameters: ParameterInfo[];

    // Whether it returns a promise the driver has to wait for.
    async: boolean;

    // The key and name of the type it returns, when that type is one of the project's own. This is
    // what makes a method on a class usable as a test input factory.
    returnKey?: { key: string; name: string };
}

// One class a run can build an instance of, so the methods on it can be called.
export interface ClassInfo {
    // What the class is called.
    name: string;

    // The name the module exports it under, or the empty string when it exports it under none.
    exportName: string;

    // The file it is written in, relative to the root of the run.
    file: string;

    // The constructor's parameters, in order.
    parameters: ParameterInfo[];

    // The key of the type an instance has, so a factory for it is found.
    key?: string;
}

// One test input factory, which is a function in a sim file returning a type the run cannot build
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

// One invariant: a function in a sim file taking a subject and no other parameter.
export interface InvariantInfo {
    // The sim file it is written in.
    file: string;

    // The name the sim file exports it under.
    exportName: string;

    // The line it starts on, counting from one.
    line: number;
}

// One scenario, which is a function in a sim file taking a subject, an injector and a checklist.
export interface ScenarioInfo {
    // The sim file it is written in.
    file: string;

    // The name the sim file exports it under.
    exportName: string;

    // The line it starts on, counting from one.
    line: number;
}

// Everything read out of one file.
export interface FileFacts {
    // The functions in it.
    functions: FunctionInfo[];

    // The classes in it.
    classes: ClassInfo[];

    // The factories in it, which only a sim file has.
    factories: FactoryInfo[];

    // The scenarios in it, which only a sim file has.
    scenarios: ScenarioInfo[];

    // The invariants in it, which only a sim file has.
    invariants: InvariantInfo[];
}

// Reads one file. `file` is the path the report prints.
export function readFile(context: RecipeContext, source: ts.SourceFile, file: string): FileFacts {
    const checker = context.checker;
    const functions: FunctionInfo[] = [];
    const classes: ClassInfo[] = [];
    const factories: FactoryInfo[] = [];
    const scenarios: ScenarioInfo[] = [];
    const invariants: InvariantInfo[] = [];
    const exportNames = exportedNames(checker, source);

    function walk(node: ts.Node): void {
        if (ts.isClassDeclaration(node) && node.name !== undefined) {
            classes.push(readClass(context, node, file, exportNames));
        }
        if (isReportedFunction(node)) {
            const info = readFunction(context, node, file, exportNames);
            functions.push(info);
            const factory = asFactory(context, node, file, info);
            if (factory !== undefined) {
                factories.push(factory);
            }
            const found = asScenarioOrInvariant(node, source, file, info);
            if (found?.kind === "scenario") {
                scenarios.push(found.it);
            }
            if (found?.kind === "invariant") {
                invariants.push(found.it);
            }
        }
        ts.forEachChild(node, walk);
    }

    walk(source);
    for (const one of classes) {
        collectMethodFactories(context, one, file, functions, factories);
    }
    return { functions, classes, factories, scenarios, invariants };
}

// Reads one function's parameters and works out how the driver reaches it.
function readFunction(
    context: RecipeContext,
    node: FunctionNode,
    file: string,
    exportNames: Map<ts.Node, string>,
): FunctionInfo {
    const checker = context.checker;
    const source = node.getSourceFile();
    const label = functionLabel(node);
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    return {
        label,
        file,
        line,
        reach: reachOf(node, exportNames),
        parameters: node.parameters.map((parameter) => readParameter(context, parameter)),
        async: returnsPromise(checker, node),
        returnKey: returnKeyOf(context, node),
    };
}

// Reads one parameter.
function readParameter(context: RecipeContext, parameter: ts.ParameterDeclaration): ParameterInfo {
    const type = context.checker.getTypeAtLocation(parameter);
    return {
        name: parameter.name.getText(parameter.getSourceFile()),
        recipe: recipeFor(context, type, parameter),
        optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
        rest: parameter.dotDotDotToken !== undefined,
    };
}

// Reads a class's constructor.
function readClass(
    context: RecipeContext,
    node: ts.ClassDeclaration,
    file: string,
    exportNames: Map<ts.Node, string>,
): ClassInfo {
    const built = node.members.find((member) => ts.isConstructorDeclaration(member)) as
        | ts.ConstructorDeclaration
        | undefined;
    const instance = context.checker.getDeclaredTypeOfSymbol(context.checker.getTypeAtLocation(node).symbol);
    return {
        name: node.name?.text ?? "(anonymous class)",
        exportName: exportNames.get(node) ?? "",
        file,
        parameters: (built?.parameters ?? []).map((parameter) => readParameter(context, parameter)),
        key: typeKeyOf(context, instance),
    };
}

// Whether a function is a test input factory, which it is when it returns a type of the project's
// own and it is exported from a sim file.
function asFactory(
    context: RecipeContext,
    node: FunctionNode,
    file: string,
    info: FunctionInfo,
): FactoryInfo | undefined {
    if (info.reach.how !== "export") {
        return undefined;
    }
    const returned = returnedType(context.checker, node);
    if (returned === undefined) {
        return undefined;
    }
    const key = typeKeyOf(context, returned);
    if (key === undefined) {
        return undefined;
    }
    return {
        key,
        typeName: (returned.aliasSymbol ?? returned.getSymbol())?.getName() ?? key,
        file,
        exportName: info.reach.name,
        parameters: info.parameters,
    };
}

// The factories written as methods on an exported class, which is how one factory hands back a
// different value on every call.
function collectMethodFactories(
    context: RecipeContext,
    owner: ClassInfo,
    file: string,
    functions: FunctionInfo[],
    factories: FactoryInfo[],
): void {
    if (owner.exportName === "") {
        return;
    }
    for (const one of functions) {
        if (one.reach.how !== "method" || one.reach.className !== owner.name || one.reach.onClass) {
            continue;
        }
        const key = one.returnKey;
        if (key === undefined) {
            continue;
        }
        factories.push({
            key: key.key,
            typeName: key.name,
            file,
            exportName: owner.exportName,
            method: one.reach.name,
            parameters: one.parameters,
            ownerParameters: owner.parameters,
        });
    }
}

// Whether a function is a scenario or an invariant, which both take the subject a run hands out.
//
// The two are told apart by how many parameters they take: a scenario takes the injector and the
// checklist beside the subject, and an invariant takes the subject alone. Neither is ever found by
// its name.
function asScenarioOrInvariant(
    node: FunctionNode,
    source: ts.SourceFile,
    file: string,
    info: FunctionInfo,
): { kind: "scenario"; it: ScenarioInfo } | { kind: "invariant"; it: InvariantInfo } | undefined {
    if (info.reach.how !== "export") {
        return undefined;
    }
    const first = info.parameters[0];
    if (first === undefined || first.recipe.kind !== "effect" || first.recipe.effect !== "subject") {
        return undefined;
    }
    const it = {
        file,
        exportName: info.reach.name,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    };
    if (info.parameters.length === 1) {
        return { kind: "invariant", it };
    }
    return { kind: "scenario", it };
}

// How the driver gets hold of a function, or why it cannot.
function reachOf(node: FunctionNode, exportNames: Map<ts.Node, string>): Reach {
    const exported = exportNames.get(node);
    if (exported !== undefined) {
        return { how: "export", name: exported };
    }
    const parent = node.parent;
    if (parent !== undefined && ts.isVariableDeclaration(parent)) {
        const named = exportNames.get(parent);
        if (named !== undefined) {
            return { how: "export", name: named };
        }
    }
    if (
        parent !== undefined &&
        (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) &&
        (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))
    ) {
        const onClass = ts.getModifiers(node)?.some((one) => one.kind === ts.SyntaxKind.StaticKeyword) === true;
        const className = parent.name?.text ?? "(anonymous class)";
        let accessor: "none" | "get" | "set" = "none";
        if (ts.isGetAccessorDeclaration(node)) {
            accessor = "get";
        }
        if (ts.isSetAccessorDeclaration(node)) {
            accessor = "set";
        }
        return {
            how: "method",
            className,
            classExport: exportNames.get(parent) ?? classExportOf(parent),
            name: node.name.getText(node.getSourceFile()),
            onClass,
            accessor,
        };
    }
    if (ts.isConstructorDeclaration(node)) {
        return { how: "inside", because: "it is a constructor, so it runs when an instance is built" };
    }
    // A declaration at the top of a file the file kept to itself. The copy exports it under a name
    // of its own, so a run calls it directly rather than waiting for something else to call it.
    const kept = keptName(node);
    if (kept !== undefined) {
        return { how: "export", name: exportedAs(kept) };
    }
    return { how: "inside", because: "it is written inside another function, so only that function reaches it" };
}

// The name a declaration at the top of a file was given, for one the file does not export. It is
// nothing for a function written inside another function, which no export reaches.
function keptName(node: FunctionNode): string | undefined {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && ts.isSourceFile(node.parent)) {
        return node.name.text;
    }
    const parent = node.parent;
    if (
        parent !== undefined &&
        ts.isVariableDeclaration(parent) &&
        ts.isIdentifier(parent.name) &&
        ts.isSourceFile(parent.parent.parent.parent)
    ) {
        return parent.name.text;
    }
    return undefined;
}

// The name a class the file kept to itself is exported from the copy under. It is empty for a class
// written inside a function, which no export reaches.
function classExportOf(node: ts.ClassDeclaration | ts.ClassExpression): string {
    if (ts.isClassDeclaration(node) && node.name !== undefined && ts.isSourceFile(node.parent)) {
        return exportedAs(node.name.text);
    }
    return "";
}

// Every declaration the module exports, with the name it exports it under.
function exportedNames(checker: ts.TypeChecker, source: ts.SourceFile): Map<ts.Node, string> {
    const names = new Map<ts.Node, string>();
    const moduleSymbol = checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) {
        return names;
    }
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
        const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        for (const declaration of resolved.declarations ?? []) {
            names.set(declaration, symbol.getName());
        }
    }
    return names;
}

// Whether the function hands back a promise, so the driver waits for it.
function returnsPromise(checker: ts.TypeChecker, node: FunctionNode): boolean {
    if (ts.getModifiers(node)?.some((one) => one.kind === ts.SyntaxKind.AsyncKeyword) === true) {
        return true;
    }
    const signature = checker.getSignatureFromDeclaration(node);
    if (signature === undefined) {
        return false;
    }
    return checker.getReturnTypeOfSignature(signature).getSymbol()?.getName() === "Promise";
}

// The type a function returns, or nothing when it returns none.
function returnedType(checker: ts.TypeChecker, node: FunctionNode): ts.Type | undefined {
    const signature = checker.getSignatureFromDeclaration(node);
    if (signature === undefined) {
        return undefined;
    }
    return checker.getReturnTypeOfSignature(signature);
}

// The key and name of the type a function returns. A factory is found by it.
export function returnKeyOf(
    context: RecipeContext,
    node: FunctionNode,
): { key: string; name: string } | undefined {
    const returned = returnedType(context.checker, node);
    if (returned === undefined) {
        return undefined;
    }
    const key = typeKeyOf(context, returned);
    if (key === undefined) {
        return undefined;
    }
    return { key, name: (returned.aliasSymbol ?? returned.getSymbol())?.getName() ?? key };
}

// Where a path is written relative to, so two files never collide in the report.
export function fileLabel(root: string, full: string): string {
    return toPosix(full.startsWith(`${root}/`) ? full.slice(root.length + 1) : full);
}
