// Finds every code path in one file, and where each one sits in the text.
//
// A path is a place in your source. Whether it ran is read from what V8 reported about the file it
// executed, so nothing is written into your code and nothing is inserted into the copy that runs.

import assert from "node:assert/strict";
import ts from "typescript";
import { topLevelLabel } from "../discover/functions.ts";
import { functionLabel, isFunctionNode, isReportedFunction, type FunctionNode } from "../discover/names.ts";

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

// One code path no range V8 reports can prove ran, so a run leaves it out of every count and lists
// it in the report file as not provable rather than reporting it as unreached on every run.
export interface NotProvable {
    // The path's own name, as a provable path would carry it.
    name: string;

    // Which file the path is in.
    file: string;

    // The line it is on.
    line: number;

    // The function it belongs to.
    fn: string;

    // What the path is.
    describe: string;
}

// What reading one file found.
export interface Paths {
    // Every path the file holds.
    paths: PathSite[];

    // The paths V8 reports no count for wherever the file is loaded.
    notProvable: NotProvable[];
}

// Reads every code path in `source`. `file` is the path the report prints.
export function pathsIn(source: ts.SourceFile, file: string): Paths {
    const paths: PathSite[] = [];
    const notProvable: NotProvable[] = [];

    // Where a node begins, in the file somebody wrote.
    function placeOf(node: ts.Node): Place {
        const at = source.getLineAndCharacterOfPosition(node.getStart(source));
        return { line: at.line + 1, column: at.character };
    }

    // Where a node ends, in the file somebody wrote.
    function endOf(node: ts.Node): Place {
        const at = source.getLineAndCharacterOfPosition(node.getEnd());
        return { line: at.line + 1, column: at.character };
    }

    // The places from which V8 counts the code that follows wrongly, one per conditional or short
    // circuit with an `await` in a side that may not run. See `withoutMiscounted`.
    const miscounted: IMiscountedStretch[] = [];

    // How many paths have been given each name so far.
    const named = new Map<string, number>();

    // Records one path of the report. A name already given in this file (two `if`s on one line, or
    // a callback whose body is counted under the function around it) gets `#2`, `#3` and so on, so
    // every path of a file has a name of its own and is counted on its own.
    function addPath(node: ts.Node, written: string, describe: string, fn: string, at: Place, against?: Place): void {
        const start = source.getLineAndCharacterOfPosition(node.getStart(source));
        const count = (named.get(written) ?? 0) + 1;
        named.set(written, count);
        const name = count === 1 ? written : `${written}#${count}`;
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
            if (hasOwnAwait(node.whenTrue) || hasOwnAwait(node.whenFalse)) {
                miscounted.push({
                    fn: here,
                    start: endOf(node),
                });
            }
        }
        if (ts.isBinaryExpression(node) && shortCircuits(node.operatorToken.kind)) {
            readShortCircuit(node, here);
            if (hasOwnAwait(node.right)) {
                miscounted.push({
                    fn: here,
                    start: endOf(node),
                });
            }
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
    //
    // V8 gives a default no block of its own: it counts the default as part of the function, so it
    // reads as run on every call, the ones that passed the argument included. A default is listed as
    // not provable rather than reported as exercised by a call that never used it.
    function readFunction(node: FunctionNode, here: string): void {
        for (const parameter of node.parameters) {
            if (parameter.initializer === undefined) {
                continue;
            }
            const named = parameter.name.getText(source);
            notProvable.push({
                name: `default:${lineOf(parameter)}:${named}`,
                file,
                line: lineOf(parameter),
                fn: here,
                describe: `the default for \`${named}\``,
            });
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
            notProvable.push({
                name: `logic:${line}:${operator}:short`,
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
            notProvable.push({
                name: `chain:${where}:skipped`,
                file,
                line,
                fn: here,
                describe: "the read skipped at `?.`",
            });
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

    // The top level of the file is a function of its own, run when the file is imported, so it is
    // entered at its first statement that is left in the loaded code and owns every path found
    // outside every function. A file of types alone has no such statement and no top-level path.
    const first = source.statements.find((statement) => !isErasedStatement(statement));
    if (first !== undefined) {
        addPath(first, `${topLevelLabel}:entered`, "the top level of the file", topLevelLabel, placeOf(first));
    }
    walk(source, topLevelLabel);
    return withoutMiscounted({ paths, notProvable }, miscounted);
}

//
// Where V8 counts code wrongly: from the end of a conditional or a short circuit with an `await` in
// a side that may not run, in one function.
//
export interface IMiscountedStretch {
    //
    // The function the stretch is in, as the report names it.
    //
    fn: string;

    //
    // Where the conditional or the short circuit ends, which is where the stretch starts.
    //
    start: Place;
}

//
// The paths of a file with those V8 cannot count moved to the not provable ones.
//
// V8 counts the code after an `await` from the place the `await` resumes. When the `await` is in a
// side of a conditional or a short circuit, V8 carries that side's count on past the end of the
// expression, up to the next block it counts on its own, so the statements in between read as run
// as often as that side ran: never, when the side never ran, however often they ran. Measured on
// Node 22 and Node 24 on 2026-10-27. A path whose place, or the place it is counted against, sits in
// such a stretch is listed as not provable rather than reported as unreached. A path with no place
// to be counted against begins a block V8 counts on its own, so the first one after the stretch
// starts, in the same function, is where it ends.
//
export function withoutMiscounted(found: Paths, stretches: IMiscountedStretch[]): Paths {
    if (stretches.length === 0) {
        return found;
    }
    const kept: PathSite[] = [];
    const notProvable = [...found.notProvable];
    for (const site of found.paths) {
        const isMiscounted = stretches.some((stretch) => isInStretch(found.paths, stretch, site));
        if (!isMiscounted) {
            kept.push(site);
            continue;
        }
        notProvable.push({
            name: site.name,
            file: site.file,
            line: site.line,
            fn: site.fn,
            describe: site.describe,
        });
    }
    assert.equal(kept.length + notProvable.length, found.paths.length + found.notProvable.length);
    return { paths: kept, notProvable };
}

//
// Whether `site`'s place, or the place it is counted against, sits in `stretch`: in the same
// function, at or after where the stretch starts and before the first block V8 counts on its own
// after that. `paths` are every path of the file, whose blocks say where the stretch ends.
//
export function isInStretch(paths: PathSite[], stretch: IMiscountedStretch, site: PathSite): boolean {
    if (site.fn !== stretch.fn) {
        return false;
    }
    let end: Place | undefined;
    for (const block of paths) {
        if (block.fn !== stretch.fn) {
            continue;
        }
        if (block.against) {
            continue;
        }
        if (isBefore(block.at, stretch.start)) {
            continue;
        }
        if (!end) {
            end = block.at;
            continue;
        }
        if (isBefore(block.at, end)) {
            end = block.at;
        }
    }
    const places = site.against ? [site.at, site.against] : [site.at];
    return places.some((place) => {
        if (isBefore(place, stretch.start)) {
            return false;
        }
        if (!end) {
            return true;
        }
        return isBefore(place, end);
    });
}

//
// Whether place `a` comes before place `b` in the file.
//
export function isBefore(a: Place, b: Place): boolean {
    if (a.line !== b.line) {
        return a.line < b.line;
    }
    return a.column < b.column;
}

//
// Whether `node` holds an `await` that belongs to the function `node` is in, rather than to a
// function written inside it.
//
export function hasOwnAwait(node: ts.Node): boolean {
    if (ts.isAwaitExpression(node)) {
        return true;
    }
    if (isFunctionNode(node)) {
        return false;
    }
    let found = false;
    ts.forEachChild(node, (child) => {
        if (!found) {
            found = hasOwnAwait(child);
        }
    });
    return found;
}

//
// Whether a statement holds types only, so transpiling leaves no code for it and V8 can never
// count it as run: an interface, a type alias, an import or export of types only, or a `declare`.
//
export function isErasedStatement(statement: ts.Statement): boolean {
    assert.ok(ts.isSourceFile(statement.parent), "Only a statement at the top level of a file is asked about.");
    assert.ok(statement.pos >= 0);
    if (ts.isInterfaceDeclaration(statement)) {
        return true;
    }
    if (ts.isTypeAliasDeclaration(statement)) {
        return true;
    }
    if (ts.isImportDeclaration(statement)) {
        return statement.importClause?.isTypeOnly === true;
    }
    if (ts.isExportDeclaration(statement)) {
        return statement.isTypeOnly;
    }
    if (ts.canHaveModifiers(statement)) {
        return (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword);
    }
    return false;
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
