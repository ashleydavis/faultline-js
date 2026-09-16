// Which nodes count as a function a run reports, and what each one is called.
//
// The instrumenter and the signature reader both walk the same tree and have to agree on this, so
// both ask here rather than each deciding.

import ts from "typescript";

// Every node that carries a body a run can measure, named or not.
export type FunctionNode =
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration
    | ts.ConstructorDeclaration
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration;

// Whether this node carries a body a run can measure.
export function isFunctionNode(node: ts.Node): node is FunctionNode {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
    );
}

// Whether a run gives this function a line of its own in the report. A callback passed to a sort
// gets no line: its branches belong to the function that wrote it, which is the function somebody
// has to go and change.
export function isReportedFunction(node: ts.Node): node is FunctionNode {
    if (ts.isFunctionDeclaration(node)) {
        return node.body !== undefined;
    }
    if (ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
        return node.body !== undefined;
    }
    if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        return node.body !== undefined;
    }
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        // A function given a name by the declaration it is assigned to reads like a declared
        // function to anybody looking at the file, so it is reported like one. One passed straight
        // to another call has no name to print and belongs to its caller.
        const parent = node.parent;
        return parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name);
    }
    return false;
}

// What a function is called in the report. A method carries the name of the class that declares
// it, so two methods called `read` are told apart.
export function functionLabel(node: FunctionNode): string {
    if (ts.isConstructorDeclaration(node)) {
        return `${ownerName(node)}.constructor`;
    }
    if (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        const own = node.name !== undefined && ts.isIdentifier(node.name) ? node.name.text : plainName(node.name);
        const owner = ownerName(node);
        if (owner === "") {
            return own;
        }
        return `${owner}.${own}`;
    }
    if (ts.isFunctionDeclaration(node)) {
        return node.name?.text ?? "(anonymous)";
    }
    const parent = node.parent;
    if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
    }
    return "(anonymous)";
}

// The class or object a method was declared on, or the empty string when it was declared on
// neither.
function ownerName(node: ts.Node): string {
    const parent = node.parent;
    if (parent === undefined) {
        return "";
    }
    if (ts.isClassDeclaration(parent) || ts.isClassExpression(parent)) {
        return parent.name?.text ?? "(anonymous class)";
    }
    if (ts.isObjectLiteralExpression(parent)) {
        const holder = parent.parent;
        if (holder !== undefined && ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)) {
            return holder.name.text;
        }
    }
    return "";
}

// A property name written out, for the names that are not plain identifiers.
function plainName(name: ts.PropertyName | undefined): string {
    if (name === undefined) {
        return "(anonymous)";
    }
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return name.text;
    }
    if (ts.isPrivateIdentifier(name)) {
        return name.text;
    }
    return name.getText();
}

// Whether this class or function is reachable from outside the file it is written in.
export function isExported(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (modifiers?.some((one) => one.kind === ts.SyntaxKind.ExportKeyword) === true) {
        return true;
    }
    const parent = node.parent;
    if (parent === undefined) {
        return false;
    }
    if (ts.isVariableDeclaration(node) && parent.parent !== undefined) {
        return isExported(parent.parent);
    }
    return false;
}
