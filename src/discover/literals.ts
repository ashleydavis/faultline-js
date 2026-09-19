// Reads the values a file's own code tests against.
//
// A made up value reaches a branch that turns on the content of an argument only by matching what
// the branch tests for. The values it tests for are written in the file: a string in a comparison,
// a number in a `case`, a flag of an enum. They are read out here and handed to the run, so a value
// made up for that file is drawn from what that file looks at.
//
// A name rather than a literal is read through the checker, so `ts.TypeFlags.String` gives the
// number it stands for. That is what a file switching on flags turns on, and no list of values
// worth trying would ever hold it.

import ts from "typescript";

// What reading one file found.
export interface Literals {
    // The values the file's own comparisons test against.
    values: (string | number | boolean)[];

    // The property names the file reads off its values, so a stand-in answers the ones it is asked
    // for rather than every name there is.
    properties: string[];
}

// The operators whose operands are worth reading. A comparison says what a branch turns on, and a
// bitwise operator is how a file switching on flags asks its question.
const testing = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.EqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken,
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.LessThanToken,
    ts.SyntaxKind.LessThanEqualsToken,
    ts.SyntaxKind.GreaterThanToken,
    ts.SyntaxKind.GreaterThanEqualsToken,
    ts.SyntaxKind.AmpersandToken,
    ts.SyntaxKind.BarToken,
    ts.SyntaxKind.InKeyword,
]);

// How many values one file hands the run. A file comparing against thousands of strings would make
// every call cost thousands of turns, and the ones a file tests against most are the ones written
// in it most.
const mostValues = 64;

// Reads them out of one file.
export function literalsIn(checker: ts.TypeChecker, source: ts.SourceFile): Literals {
    // What a branch turns on directly. These come first, because a value a comparison tests against
    // is the one that decides which way the branch goes.
    const tested: (string | number | boolean)[] = [];

    // What the file hands to a call. A separator handed to `split`, a pattern handed to `replace`:
    // the code after the call turns on what the call made of it, so the value matters as much.
    const given: (string | number | boolean)[] = [];

    const properties: string[] = [];

    // Takes what one expression is worth, when it is worth anything.
    function take(node: ts.Node, into: (string | number | boolean)[]): void {
        const held = valueOf(checker, node);
        if (held !== undefined && !tested.includes(held) && !given.includes(held)) {
            into.push(held);
        }
    }

    function visit(node: ts.Node): void {
        if (ts.isBinaryExpression(node) && testing.has(node.operatorToken.kind)) {
            take(node.left, tested);
            take(node.right, tested);
        }
        if (ts.isCaseClause(node)) {
            take(node.expression, tested);
        }
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            // A `new` written with no brackets at all carries no argument list.
            for (const argument of node.arguments ?? []) {
                take(argument, given);
            }
        }
        if (ts.isPropertyAccessExpression(node) && !properties.includes(node.name.text)) {
            properties.push(node.name.text);
        }
        if (ts.isElementAccessExpression(node)) {
            take(node.argumentExpression, tested);
        }
        ts.forEachChild(node, visit);
    }

    visit(source);
    return { values: [...tested, ...given].slice(0, mostValues), properties: properties.slice(0, mostValues) };
}

// What one expression is worth, for an expression the checker knows one value for. A name whose
// type is a single value, such as a member of an enum, is worth that value.
export function valueOf(checker: ts.TypeChecker, node: ts.Node): string | number | boolean | undefined {
    const type = checker.getTypeAtLocation(node);
    if (type.isStringLiteral() || type.isNumberLiteral()) {
        return type.value;
    }
    if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
        return checker.typeToString(type) === "true";
    }
    return undefined;
}
