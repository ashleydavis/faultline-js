// Finds every code path in one file, and where each one sits in the text.
//
// A path is a place in your source. Whether it ran is read from what V8 reported about the file it
// executed, so nothing is written into your code and nothing is inserted into the copy that runs.

import ts from "typescript";
import { functionLabel, isFunctionNode, isReportedFunction, type FunctionNode } from "./names.ts";

// One code path a run reports, and how to tell whether it ran.
export interface PathSite {
    // The path's own name, stable across runs, for example "if:12:true".
    name: string;

    // What the path is, written so it can be read at the end of a sentence.
    describe: string;

    // Which file the path is in, relative to the root of the run.
    file: string;

    // The line the path starts on, counting from one.
    line: number;

    // The function the path belongs to, as the report names it.
    fn: string;

    // Where in the file the path's own code begins. It ran when V8 counted this place as run.
    at: Place;

    // When this is set, the path ran when `at` ran more often than this place did. That is how the
    // side of an `if` with no `else` is seen, and how a short circuit is seen.
    against?: Place;
}

// One position in the file somebody wrote.
export interface Place {
    // The line, counting from one.
    line: number;

    // The column, counting from zero.
    column: number;
}

// One branch V8 reports no count for, so a run leaves it out of the total rather than reporting it
// as unreached on every run.
export interface Unseen {
    // Which file the branch is in.
    file: string;

    // The line it is on.
    line: number;

    // The function it belongs to.
    fn: string;

    // What the branch is.
    describe: string;
}

// What reading one file found.
export interface Paths {
    // Every path the file holds.
    paths: PathSite[];

    // The branches V8 reports no count for.
    unseen: Unseen[];
}

// Reads every code path in `source`. `file` is the path the report prints.
export function pathsIn(source: ts.SourceFile, file: string): Paths {
    const paths: PathSite[] = [];
    const unseen: Unseen[] = [];

    // Where a node begins, in the file somebody wrote.
    function placeOf(node: ts.Node): Place {
        const at = source.getLineAndCharacterOfPosition(node.getStart(source));
        return { line: at.line + 1, column: at.character };
    }

    // Records one path of the report.
    function addPath(node: ts.Node, name: string, describe: string, fn: string, at: Place, against?: Place): void {
        const start = source.getLineAndCharacterOfPosition(node.getStart(source));
        paths.push({ name, describe, file, line: start.line + 1, fn, at, against });
    }

    // The line a node starts on. Every path name is built from it.
    function lineOf(node: ts.Node): number {
        return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    }

    // Where the first statement of a body sits, which is the place that says the body ran.
    function bodyPlace(body: ts.Statement): Place {
        if (ts.isBlock(body)) {
            const first = body.statements[0];
            if (first !== undefined) {
                return placeOf(first);
            }
            // An empty body has no statement to point at, so the brace itself stands for it.
            return placeOf(body);
        }
        return placeOf(body);
    }

    // Walks the tree, carrying the name of the function whose line every path found below belongs
    // to.
    function walk(node: ts.Node, owner: string): void {
        let here = owner;
        if (isFunctionNode(node)) {
            here = isReportedFunction(node) ? functionLabel(node) : owner;
            readFunction(node, here);
        }
        if (ts.isIfStatement(node)) {
            readIf(node, here);
        }
        if (ts.isConditionalExpression(node)) {
            const line = lineOf(node);
            addPath(node.whenTrue, `ternary:${line}:true`, "the true side of the conditional", here, placeOf(node.whenTrue));
            addPath(node.whenFalse, `ternary:${line}:false`, "the false side of the conditional", here, placeOf(node.whenFalse));
        }
        if (ts.isBinaryExpression(node) && shortCircuits(node.operatorToken.kind)) {
            readShortCircuit(node, here);
        }
        if (ts.isSwitchStatement(node)) {
            readSwitch(node, here);
        }
        if (isLoop(node)) {
            const line = lineOf(node);
            addPath(node.statement, `loop:${line}:body`, "the body of the loop", here, bodyPlace(node.statement));
        }
        if (ts.isCatchClause(node)) {
            addPath(node, `catch:${lineOf(node)}`, "the catch", here, bodyPlace(node.block));
        }
        if (isOptionalChain(node)) {
            readChain(node, here);
        }
        ts.forEachChild(node, (child) => {
            walk(child, here);
        });
    }

    // Reads a function's body and each default its parameters carry.
    function readFunction(node: FunctionNode, here: string): void {
        for (const parameter of node.parameters) {
            if (parameter.initializer === undefined) {
                continue;
            }
            const named = parameter.name.getText(source);
            addPath(
                parameter,
                `default:${lineOf(parameter)}:${named}`,
                `the default for \`${named}\``,
                here,
                placeOf(parameter.initializer),
            );
        }
        const body = node.body;
        if (body === undefined) {
            return;
        }
        const at = ts.isBlock(body) ? bodyPlace(body) : placeOf(body);
        addPath(node, `${here}:entered`, `the body of ${here}`, here, at);
    }

    // Reads both sides of an `if`.
    //
    // The false side has no place of its own: it ran whenever the `if` itself ran and the true side
    // did not, which is the same answer whether an `else` was written or left out.
    function readIf(node: ts.IfStatement, here: string): void {
        const line = lineOf(node);
        const taken = bodyPlace(node.thenStatement);
        addPath(node, `if:${line}:true`, "the true side of the if", here, taken);
        addPath(node, `if:${line}:false`, "the false side of the if", here, placeOf(node), taken);
    }

    // Reads the right side of `&&`, `||` or `??`, and the case where it was never reached.
    //
    // The skipped side is counted against the expression being reached. Inside a loop's own
    // condition there is no count for that: V8 counts blocks, and a condition tested once per turn
    // of a loop sits in the block around the loop, which ran once. So the skipped side is left out
    // there rather than reported as unreached every time.
    function readShortCircuit(node: ts.BinaryExpression, here: string): void {
        const operator = node.operatorToken.getText(source);
        const line = lineOf(node);
        const right = placeOf(node.right);
        addPath(node.right, `logic:${line}:${operator}:taken`, `the right side of \`${operator}\``, here, right);
        if (inLoopCondition(node)) {
            unseen.push({
                file,
                line,
                fn: here,
                describe: `the short circuit of \`${operator}\``,
            });
            return;
        }
        addPath(node, `logic:${line}:${operator}:short`, `the short circuit of \`${operator}\``, here, placeOf(node), right);
    }

    // Reads both sides of `?.`: the read that happened, and the one skipped because what was on the
    // left was nothing.
    //
    // It is counted the way `&&` is. The part after the `?.` ran when what was on the left was
    // something, and the skipped side is that count taken from the count of the whole expression.
    // Inside a loop's own condition there is no count to take it from, for the reason above.
    function readChain(node: ts.Node, here: string): void {
        const line = lineOf(node);
        const past = pastTheQuestion(node);
        if (past === undefined) {
            return;
        }
        // The column is in the name as well as the line, because `a?.b?.c` is two of these on one
        // line and two paths sharing a name are one path to everything that reads them.
        const where = `${line}:${placeOf(past).column}`;
        addPath(past, `chain:${where}:read`, "the read past `?.`", here, placeOf(past));
        if (inLoopCondition(node)) {
            unseen.push({ file, line, fn: here, describe: "the skipped read at `?.`" });
            return;
        }
        addPath(node, `chain:${where}:skipped`, "the read skipped at `?.`", here, placeOf(node), placeOf(past));
    }

    // Reads every arm of a switch that has a statement to point at.
    function readSwitch(node: ts.SwitchStatement, here: string): void {
        for (const clause of node.caseBlock.clauses) {
            const first = clause.statements[0];
            if (first === undefined) {
                // An arm with no statement of its own falls through to the next one, so it is the
                // next arm's path that says either of them ran.
                continue;
            }
            const line = lineOf(clause);
            if (ts.isDefaultClause(clause)) {
                addPath(clause, `case:${line}:default`, "the default arm of the switch", here, placeOf(first));
                continue;
            }
            addPath(clause, `case:${line}`, `the arm at line ${line} of the switch`, here, placeOf(first));
        }
    }

    walk(source, "(top level)");
    return { paths, unseen };
}

// Whether a node sits inside the condition a loop tests every turn, where V8 reports no count for
// how often that condition ran.
export function inLoopCondition(node: ts.Node): boolean {
    let child = node;
    let parent = node.parent;
    while (parent !== undefined) {
        if (ts.isWhileStatement(parent) || ts.isDoStatement(parent)) {
            if (parent.expression === child) {
                return true;
            }
        }
        if (ts.isForStatement(parent)) {
            if (parent.condition === child || parent.incrementor === child) {
                return true;
            }
        }
        if (isFunctionNode(parent)) {
            return false;
        }
        child = parent;
        parent = parent.parent;
    }
    return false;
}

// Whether a node reads through `?.`, which is a branch: what was on the left is something, or it is
// nothing and everything after the `?.` is skipped.
export function isOptionalChain(node: ts.Node): boolean {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) || ts.isCallExpression(node)) {
        return node.questionDotToken !== undefined;
    }
    return false;
}

// What sits past the `?.`, which is the part that runs only when what was on the left was
// something. It is the property for a read, the index for a lookup and the first argument for a
// call, and nothing for a call written with no arguments, which has no place of its own to count.
export function pastTheQuestion(node: ts.Node): ts.Node | undefined {
    if (ts.isPropertyAccessExpression(node)) {
        return node.name;
    }
    if (ts.isElementAccessExpression(node)) {
        return node.argumentExpression;
    }
    if (ts.isCallExpression(node)) {
        return node.arguments[0];
    }
    return undefined;
}


// Whether this operator only evaluates its right side sometimes.
function shortCircuits(kind: ts.SyntaxKind): boolean {
    return (
        kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        kind === ts.SyntaxKind.BarBarToken ||
        kind === ts.SyntaxKind.QuestionQuestionToken
    );
}

// Every node that runs a body more than once.
type LoopNode = ts.ForStatement | ts.ForOfStatement | ts.ForInStatement | ts.WhileStatement | ts.DoStatement;

// Whether this node runs a body more than once.
function isLoop(node: ts.Node): node is LoopNode {
    return (
        ts.isForStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node)
    );
}
