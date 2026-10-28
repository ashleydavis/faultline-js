// Reads the conditions in one function, so the value chooser can try values on each side of every
// value a function tests against.
//
// Faultline does not follow a value through the function. It reads each comparison against a
// literal, each `startsWith`, `endsWith` and `includes` with a literal, each `in` with a literal
// key, each `case`, each `typeof` check and each `instanceof` check, and reports the value tested
// against and the source text of what is tested. A name is read through the checker, so a named
// constant gives its value.

import assert from "node:assert/strict";
import ts from "typescript";
import { isFunctionNode, type FunctionNode } from "./names.ts";

// What sort of condition it is.
export type ConditionKind =
    | "comparison"
    | "starts-with"
    | "ends-with"
    | "includes"
    | "in"
    | "case"
    | "typeof"
    | "instanceof";

// The comparison operators a condition can use, written as they are in the source.
export type ConditionOperator = "===" | "!==" | "==" | "!=" | "<" | "<=" | ">" | ">=";

// The value a condition tests against.
//
// A bigint is held as its decimal digits, so a condition is plain data that can be sent to another
// process and written into the report file as it is.
export interface ConditionLiteral {
    // Which JavaScript type the value has.
    kind: "string" | "number" | "boolean" | "bigint" | "null" | "undefined";

    // The value: a string, a number, a boolean, the decimal digits of a bigint, or undefined for
    // `null` and `undefined`, which the kind already says.
    value: string | number | boolean | undefined;
}

// One condition found in a function.
export interface Condition {
    // The line the condition is on, counting from one.
    line: number;

    // What sort of condition it is.
    kind: ConditionKind;

    // The operator, for a comparison and a `typeof` check. A comparison with the literal on the left
    // (`3 < x`) is reported as if the literal were on the right (`x > 3`), so the operator always
    // reads as "subject, operator, literal".
    operator?: ConditionOperator;

    // The value tested against. Every kind but `instanceof` has one.
    literal?: ConditionLiteral;

    // The class an `instanceof` check tests against, as the source writes it.
    className?: string;

    // The source text of what is tested: the other side of a comparison, the string a `startsWith`
    // is called on, the value an `includes` looks for in a list of literals, the object an `in`
    // looks in, the value a `switch` tests, the operand of `typeof`, or the left of `instanceof`.
    subject: string;
}

// One condition and the offset in the file where it starts.
export interface PlacedCondition {
    // The offset in the file where the condition starts.
    start: number;

    // The condition.
    condition: Condition;
}

// The operators of a comparison, by the token the parser gives each one.
const operatorByToken = new Map<ts.SyntaxKind, ConditionOperator>([
    [ts.SyntaxKind.EqualsEqualsEqualsToken, "==="],
    [ts.SyntaxKind.ExclamationEqualsEqualsToken, "!=="],
    [ts.SyntaxKind.EqualsEqualsToken, "=="],
    [ts.SyntaxKind.ExclamationEqualsToken, "!="],
    [ts.SyntaxKind.LessThanToken, "<"],
    [ts.SyntaxKind.LessThanEqualsToken, "<="],
    [ts.SyntaxKind.GreaterThanToken, ">"],
    [ts.SyntaxKind.GreaterThanEqualsToken, ">="],
]);

// The operator a comparison has once its two sides are swapped, so `3 < x` reads as `x > 3`.
const swappedOperator: Record<ConditionOperator, ConditionOperator> = {
    "===": "===",
    "!==": "!==",
    "==": "==",
    "!=": "!=",
    "<": ">",
    "<=": ">=",
    ">": "<",
    ">=": "<=",
};

// Every condition in `node`, in the order they are written.
//
// For a function that is everything in its body, including the functions written inside it,
// because those run only when this function calls them. For a whole file it is the code at the top
// level, leaving out every function body, because that is what importing the file runs.
export function conditionsIn(checker: ts.TypeChecker, node: FunctionNode | ts.SourceFile): Condition[] {
    const source = node.getSourceFile();
    const isFile = ts.isSourceFile(node);
    if (!isFile) assert.ok(node.body !== undefined, "A function with no body has no conditions to read.");

    // Each condition with where it starts in the file, so they can be put in the order they are
    // written: a `case` is read with its `switch`, before the conditions inside the cases above it.
    const found: PlacedCondition[] = [];

    // Records one condition read at one node.
    function add(at: ts.Node, condition: Omit<Condition, "line">): void {
        const start = at.getStart(source);
        found.push({ start, condition: { line: source.getLineAndCharacterOfPosition(start).line + 1, ...condition } });
    }

    // The source text of one node.
    function textOf(at: ts.Node): string {
        return at.getText(source);
    }

    // Reads one node and everything inside it.
    function visit(at: ts.Node): void {
        if (isFile && isFunctionNode(at)) {
            return;
        }
        if (ts.isBinaryExpression(at)) {
            readBinary(at);
        }
        if (ts.isCallExpression(at)) {
            readCall(at);
        }
        if (ts.isSwitchStatement(at)) {
            readSwitch(at);
        }
        ts.forEachChild(at, visit);
    }

    // A comparison, a `typeof` check, an `in` or an `instanceof`.
    function readBinary(at: ts.BinaryExpression): void {
        const token = at.operatorToken.kind;
        if (token === ts.SyntaxKind.InstanceOfKeyword) {
            add(at, { kind: "instanceof", className: textOf(at.right), subject: textOf(at.left) });
            return;
        }
        if (token === ts.SyntaxKind.InKeyword) {
            const key = literalOf(checker, at.left);
            if (key !== undefined) {
                add(at, { kind: "in", literal: key, subject: textOf(at.right) });
            }
            return;
        }
        const operator = operatorByToken.get(token);
        if (operator === undefined) {
            return;
        }
        const right = literalOf(checker, at.right);
        const left = literalOf(checker, at.left);
        const subject = right !== undefined ? at.left : at.right;
        const literal = right ?? left;
        if (literal === undefined) {
            // Neither side is a literal, so there is no value to try on each side of.
            return;
        }
        const written = right !== undefined ? operator : swappedOperator[operator];
        const tested = skipParentheses(subject);
        if (ts.isTypeOfExpression(tested) && literal.kind === "string") {
            add(at, { kind: "typeof", operator: written, literal, subject: textOf(tested.expression) });
            return;
        }
        add(at, { kind: "comparison", operator: written, literal, subject: textOf(subject) });
    }

    // A `startsWith`, `endsWith` or `includes` with a literal.
    function readCall(at: ts.CallExpression): void {
        if (!ts.isPropertyAccessExpression(at.expression) || at.arguments.length !== 1) {
            return;
        }
        const method = at.expression.name.text;
        const kind = callKinds.get(method);
        if (kind === undefined) {
            return;
        }
        const receiver = at.expression.expression;
        const argument = at.arguments[0]!;
        const literal = literalOf(checker, argument);
        if (literal !== undefined) {
            add(at, { kind, literal, subject: textOf(receiver) });
            return;
        }
        if (kind !== "includes") {
            return;
        }
        // A list of literals asked whether it holds a value: each literal is a value to try for the
        // value asked about.
        const list = listOf(checker, receiver);
        for (const element of list?.elements ?? []) {
            const held = literalOf(checker, element);
            if (held !== undefined) {
                add(at, { kind: "includes", literal: held, subject: textOf(argument) });
            }
        }
    }

    // Each `case` of a `switch` with a literal. A `switch (typeof x)` reads as `typeof` checks on `x`.
    function readSwitch(at: ts.SwitchStatement): void {
        const tested = skipParentheses(at.expression);
        for (const clause of at.caseBlock.clauses) {
            if (!ts.isCaseClause(clause)) {
                continue;
            }
            const literal = literalOf(checker, clause.expression);
            if (literal === undefined) {
                continue;
            }
            if (ts.isTypeOfExpression(tested) && literal.kind === "string") {
                add(clause, { kind: "typeof", operator: "===", literal, subject: textOf(tested.expression) });
                continue;
            }
            add(clause, { kind: "case", literal, subject: textOf(at.expression) });
        }
    }

    ts.forEachChild(node, visit);
    return found.sort((left, right) => left.start - right.start).map((one) => one.condition);
}

// The kind of condition each string and list method with one argument makes.
const callKinds = new Map<string, ConditionKind>([
    ["startsWith", "starts-with"],
    ["endsWith", "ends-with"],
    ["includes", "includes"],
]);

// The expression inside any number of brackets.
export function skipParentheses(node: ts.Expression): ts.Expression {
    let inner = node;
    // Each turn takes off one pair of brackets, and an expression holds finitely many.
    while (ts.isParenthesizedExpression(inner)) {
        inner = inner.expression;
    }
    return inner;
}

// The list of literals an expression is: a list written out, or a constant holding one.
export function listOf(checker: ts.TypeChecker, node: ts.Expression): ts.ArrayLiteralExpression | undefined {
    const inner = skipParentheses(node);
    if (ts.isArrayLiteralExpression(inner)) {
        return inner;
    }
    if (!ts.isIdentifier(inner)) {
        return undefined;
    }
    const declaration = checker.getSymbolAtLocation(inner)?.valueDeclaration;
    if (declaration === undefined || !ts.isVariableDeclaration(declaration) || declaration.initializer === undefined) {
        return undefined;
    }
    if ((ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) === 0) {
        // A list held by a variable that can be given another list says nothing about what the
        // condition will test against.
        return undefined;
    }
    let initializer = skipParentheses(declaration.initializer);
    if (ts.isAsExpression(initializer)) {
        initializer = skipParentheses(initializer.expression);
    }
    return ts.isArrayLiteralExpression(initializer) ? initializer : undefined;
}

// The one value an expression always has, read through the checker, or undefined when the checker
// knows of no single value for it.
export function literalOf(checker: ts.TypeChecker, node: ts.Expression): ConditionLiteral | undefined {
    const inner = skipParentheses(node);
    if (inner.kind === ts.SyntaxKind.NullKeyword) {
        return { kind: "null", value: undefined };
    }
    const type = checker.getTypeAtLocation(inner);
    if (type.isStringLiteral()) {
        return { kind: "string", value: type.value };
    }
    if (type.isNumberLiteral()) {
        return { kind: "number", value: type.value };
    }
    if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
        return { kind: "boolean", value: checker.typeToString(type) === "true" };
    }
    if ((type.flags & ts.TypeFlags.BigIntLiteral) !== 0) {
        // The checker has a guard for string and number literal types and none for a bigint literal
        // type, so the flag checked above is what says the type is one.
        const held = (type as ts.BigIntLiteralType).value;
        return { kind: "bigint", value: `${held.negative ? "-" : ""}${held.base10Value}` };
    }
    if ((type.flags & ts.TypeFlags.Undefined) !== 0 && isUndefinedWritten(inner)) {
        return { kind: "undefined", value: undefined };
    }
    return undefined;
}

// Whether an expression is `undefined` itself or `void` of something, rather than any expression
// whose type happens to be undefined, such as a call to a function that returns nothing.
export function isUndefinedWritten(node: ts.Expression): boolean {
    if (ts.isIdentifier(node)) {
        return node.text === "undefined";
    }
    return ts.isVoidExpression(node);
}
