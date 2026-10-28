// Reads every function, method, getter, setter, constructor and the top-level code of one file:
// how Faultline reaches each one, the type of each parameter and the recipe for building its values,
// and what stops Faultline calling the ones it cannot.

import assert from "node:assert/strict";
import ts from "typescript";
import { functionLabel, isFunctionNode, isReportedFunction, type FunctionNode } from "./names.ts";
import { leafKey, nameOf, recipeFor, recipeUnderWrittenAlias, typeKeyOf, writtenAliasKey, type Recipe, type RecipeContext } from "./recipes.ts";
import { toPosix } from "./sources.ts";

// One parameter of a function, and how to build values for it.
export interface ParameterInfo {
    // What the parameter is called, as the report prints it.
    name: string;

    // Its type, written the way the checker writes it, for the report and a crash's list of values.
    typeName: string;

    // How to build a value for it.
    recipe: Recipe;

    // Whether a call may leave it out.
    optional: boolean;

    // Whether it takes everything left, as `...rest` does.
    rest: boolean;
}

// How the driver gets hold of a function.
//
// A declaration at the top of a file that the file keeps to itself is reached by its own name,
// because the copy Faultline loads exports every top-level declaration. It is told apart from one
// the file exports, because only what a sim file exports is offered to the run. A constructor is
// reached by building an instance of its class, a method on an object written out by the constant
// holding the object, and the top-level code by importing the file.
export type Reach =
    | { how: "export"; name: string }
    | { how: "private"; name: string }
    | { how: "method"; className: string; classExport: string; name: string; onClass: boolean; accessor: "none" | "get" | "set" }
    | { how: "construct"; className: string; classExport: string }
    | { how: "property"; holder: string; name: string; accessor: "none" | "get" | "set" }
    | { how: "module" }
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

    // The function it is written inside, as the report labels that one, for a function written
    // inside another. Its paths belong to that function's unit, because the call that runs them is
    // the one the function around it makes.
    within?: string;

    // Its parameters, in order.
    parameters: ParameterInfo[];

    // Whether it returns a promise the driver has to wait for.
    async: boolean;

    // The key and name of the type it returns, when that type is one of the project's own. This is
    // what makes a method on a class usable as a value factory.
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

// One function Faultline cannot call, and what stops it, so the report can say why its code paths
// are reached only through the function around it or not at all.
export interface UncallableFunction {
    // What the report calls it.
    label: string;

    // The line it starts on, counting from one.
    line: number;

    // What stops Faultline calling it, as a clause the report finishes a sentence with.
    because: string;
}

// Everything read out of one file.
export interface FileFacts {
    // The functions in it.
    functions: FunctionInfo[];

    // The classes in it.
    classes: ClassInfo[];

    // The functions in it that Faultline cannot call, each with what stops it.
    uncallable: UncallableFunction[];
}

// Reads one file. `file` is the path the report prints.
//
// The code at the top level of the file comes first, as a function of its own labelled
// `(top level)`, because importing the file runs it and it has code paths like any function.
export function readFile(context: RecipeContext, source: ts.SourceFile, file: string): FileFacts {
    const functions: FunctionInfo[] = [
        {
            label: topLevelLabel,
            file,
            line: 1,
            reach: { how: "module" },
            parameters: [],
            // Importing a file hands back a promise, whatever the file holds.
            async: true,
        },
    ];
    const classes: ClassInfo[] = [];
    const exportNames = exportedNames(context.checker, source);

    function walk(node: ts.Node): void {
        if (ts.isClassDeclaration(node) && node.name !== undefined) {
            classes.push(readClass(context, node, node.name, file, exportNames));
        }
        if (isReportedFunction(node)) {
            functions.push(readFunction(context, node, file, exportNames));
        }
        ts.forEachChild(node, walk);
    }

    walk(source);
    const uncallable: UncallableFunction[] = [];
    for (const one of functions) {
        if (one.reach.how === "inside") {
            uncallable.push({ label: one.label, line: one.line, because: one.reach.because });
        }
    }
    assert.equal(functions[0]?.reach.how, "module");
    return { functions, classes, uncallable };
}

// What the report calls the code at the top level of a file. The code path reader labels the code
// it finds outside every function the same way, so the two agree on who owns it.
export const topLevelLabel = "(top level)";

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
        within: withinName(node),
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
        typeName: nameOf(context.checker, type),
        recipe: recipeUnderWrittenAlias(context, recipeFor(context, type, parameter), parameter.type),
        optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
        rest: parameter.dotDotDotToken !== undefined,
    };
}

// Reads a class's constructor.
function readClass(
    context: RecipeContext,
    node: ts.ClassDeclaration,
    name: ts.Identifier,
    file: string,
    exportNames: Map<ts.Node, string>,
): ClassInfo {
    const built = node.members.find((member) => ts.isConstructorDeclaration(member)) as
        | ts.ConstructorDeclaration
        | undefined;
    const instance = context.checker.getDeclaredTypeOfSymbol(context.checker.getTypeAtLocation(node).symbol);
    return {
        name: name.text,
        exportName: exportNames.get(node) ?? "",
        file,
        parameters: (built?.parameters ?? []).map((parameter) => readParameter(context, parameter)),
        key: typeKeyOf(context, instance),
    };
}

// How the driver gets hold of a function, or why it cannot.
function reachOf(node: FunctionNode, exportNames: Map<ts.Node, string>): Reach {
    const exported = exportNames.get(node);
    if (exported !== undefined) {
        return { how: "export", name: exported };
    }
    // A parsed node always has a parent, so there is no check for one here or below.
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent)) {
        const named = exportNames.get(parent);
        if (named !== undefined) {
            return { how: "export", name: named };
        }
    }
    if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) {
        return memberReach(node, parent, exportNames);
    }
    if (ts.isObjectLiteralExpression(parent)) {
        return propertyReach(node, parent, exportNames);
    }
    // A declaration at the top of a file the file kept to itself. The copy exports it under its own
    // name, so a run calls it directly rather than waiting for something else to call it.
    const kept = keptName(node);
    if (kept !== undefined) {
        return { how: "private", name: kept };
    }
    return { how: "inside", because: "it is written inside another function, so only that function reaches it" };
}

// How the driver reaches a constructor, method, getter or setter declared in a class, or why it
// cannot.
function memberReach(
    node: FunctionNode,
    owner: ts.ClassDeclaration | ts.ClassExpression,
    exportNames: Map<ts.Node, string>,
): Reach {
    const className = owner.name?.text ?? "(anonymous class)";
    const classExport = exportNames.get(owner) ?? classExportOf(owner, exportNames);
    if (classExport === "") {
        return { how: "inside", because: "its class is written inside a function, so only that function reaches it" };
    }
    const onClass = ts.getModifiers(node)?.some((one) => one.kind === ts.SyntaxKind.StaticKeyword) === true;
    const isAbstract = ts.getModifiers(owner)?.some((one) => one.kind === ts.SyntaxKind.AbstractKeyword) === true;
    if (isAbstract && !onClass) {
        return { how: "inside", because: "its class is abstract, so no instance of it can be built" };
    }
    if (ts.isConstructorDeclaration(node)) {
        return { how: "construct", className, classExport };
    }
    // Every reported function directly inside a class that is not a constructor is a method, a
    // getter or a setter, and each of those has a name.
    assert.ok(ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node));
    if (ts.isPrivateIdentifier(node.name)) {
        return { how: "inside", because: `it is the private method ${node.name.text} of its class, so only code inside the class reaches it` };
    }
    const name = memberName(node.name);
    if (name === undefined) {
        return { how: "inside", because: "its name is worked out while the code runs, so there is no name to call it by" };
    }
    return { how: "method", className, classExport, name, onClass, accessor: accessorOf(node) };
}

// How the driver reaches a method, getter or setter written in an object, which is through the
// constant at the top of the file that holds the object, or why it cannot.
function propertyReach(node: FunctionNode, owner: ts.ObjectLiteralExpression, exportNames: Map<ts.Node, string>): Reach {
    // A reported function directly inside an object written out is a method, a getter or a setter.
    assert.ok(ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node));
    const holder = owner.parent;
    if (!ts.isVariableDeclaration(holder) || !ts.isIdentifier(holder.name) || !ts.isSourceFile(holder.parent.parent.parent)) {
        return { how: "inside", because: "it is written in an object no constant at the top of the file holds, so only code holding that object reaches it" };
    }
    const name = memberName(node.name);
    if (name === undefined) {
        return { how: "inside", because: "its name is worked out while the code runs, so there is no name to call it by" };
    }
    return { how: "property", holder: exportNames.get(holder) ?? holder.name.text, name, accessor: accessorOf(node) };
}

// Whether a member is a getter, a setter or neither.
function accessorOf(node: ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration): "none" | "get" | "set" {
    if (ts.isGetAccessorDeclaration(node)) {
        return "get";
    }
    if (ts.isSetAccessorDeclaration(node)) {
        return "set";
    }
    return "none";
}

// The name a member is called by, or undefined for a name worked out while the code runs, such as
// `[Symbol.iterator]`, which has no name to write. A private name is told apart before this is
// asked.
export function memberName(name: ts.PropertyName): string | undefined {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    if (ts.isComputedPropertyName(name) && (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))) {
        return name.expression.text;
    }
    return undefined;
}

// The name a declaration at the top of a file was given, for one the file does not export. It is
// nothing for a function written inside another function, which no export reaches.
function keptName(node: FunctionNode): string | undefined {
    if (ts.isFunctionDeclaration(node) && node.name !== undefined && ts.isSourceFile(node.parent)) {
        return node.name.text;
    }
    const parent = node.parent;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && ts.isSourceFile(parent.parent.parent.parent)) {
        return parent.name.text;
    }
    return undefined;
}

// The function one function is written inside, as the report labels it, or nothing for one written
// at the top of the file.
//
// A function written inside another is reached only by the one around it, so its paths belong to
// that function's unit and are what say whether that unit has more to try.
function withinName(node: FunctionNode): string | undefined {
    let held = node.parent as ts.Node | undefined;
    while (held !== undefined && !ts.isSourceFile(held)) {
        if (isFunctionNode(held) && isReportedFunction(held)) {
            return functionLabel(held);
        }
        held = held.parent as ts.Node | undefined;
    }
    return undefined;
}

// The name a class is reached under when the file does not export the class itself: its own name
// for a class declared at the top of the file, which the copy exports, or the name of the constant
// at the top of the file that holds a class written as an expression. It is empty for a class
// written inside a function, which no export reaches.
function classExportOf(node: ts.ClassDeclaration | ts.ClassExpression, exportNames: Map<ts.Node, string>): string {
    if (ts.isClassDeclaration(node) && node.name !== undefined && ts.isSourceFile(node.parent)) {
        return node.name.text;
    }
    const holder = node.parent;
    if (ts.isClassExpression(node) && ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name) && ts.isSourceFile(holder.parent.parent.parent)) {
        return exportNames.get(holder) ?? holder.name.text;
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
    const written = writtenAliasKey(context, node.type);
    if (written) {
        return written;
    }
    const key = typeKeyOf(context, returned);
    if (key === undefined) {
        return builtInReturnKey(context, node, returned);
    }
    // The key was built from this type's symbol, so it has one and that symbol carries the name.
    return { key, name: (returned.aliasSymbol ?? returned.getSymbol())!.getName() };
}

//
// The names of the built-in object types a value factory may return, which `leafKey` gives a key.
//
const builtInValueNames: ReadonlySet<string> = new Set([
    "Date",
    "RegExp",
    "URL",
    "Uint8Array",
    "Buffer",
    "ArrayBuffer",
    "Error",
    "TypeError",
    "RangeError",
]);

//
// The key and name of a built-in value type a function returns, such as `string` or `Date`, or
// nothing for any other type. Only those types have their recipe read here, because every function
// of every file has its return type read and the recipe of a large type takes time to read.
//
export function builtInReturnKey(context: RecipeContext, node: FunctionNode, returned: ts.Type): { key: string; name: string } | undefined {
    const valueFlags = ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.BigInt | ts.TypeFlags.Boolean | ts.TypeFlags.Unknown | ts.TypeFlags.Any | ts.TypeFlags.NonPrimitive;
    if (!(returned.flags & valueFlags)) {
        const symbol = returned.getSymbol();
        if (!symbol) {
            return undefined;
        }
        if (!builtInValueNames.has(symbol.getName())) {
            return undefined;
        }
    }
    //
    // Every type let through above reads as a built-in value, so it has a key.
    //
    const key = leafKey(recipeFor(context, returned, node));
    assert(key !== undefined, `The built-in type ${nameOf(context.checker, returned)} has no key for its value factories.`);
    assert(key.startsWith("builtin#"));
    return { key, name: nameOf(context.checker, returned) };
}

// Where a path is written relative to, so two files never collide in the report.
export function fileLabel(root: string, full: string): string {
    return toPosix(full.startsWith(`${root}/`) ? full.slice(root.length + 1) : full);
}
