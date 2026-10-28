//
// Exports every top-level function, class and variable of a project file, in the copy Faultline
// loads, so a declaration the file keeps to itself can be called by its own name.
//
// It is a transformer the transpile runs, so the copy is built from syntax nodes and every node
// keeps the place it had in the source. The source map then puts each line back where it was.
//

import assert from "node:assert/strict";
import ts from "typescript";

//
// The transformer the transpile is given. A statement is changed only by putting `export` in front
// of it, which moves nothing in the source.
//
export function exportEverything(context: ts.TransformationContext): ts.Transformer<ts.SourceFile> {
    assert(context.factory !== undefined);
    return (sourceFile: ts.SourceFile): ts.SourceFile => exportedCopy(sourceFile, context.factory);
}

//
// The source file with `export` put in front of every top-level declaration that has none. A
// declaration whose name the file already exports in some other way is left alone, because a
// module that exports a name twice does not load.
//
//
// A variable is exported by an `export { ... }` list put after the last statement rather than by
// `export` in front of its statement. TypeScript's CommonJS output turns an exported variable
// statement into assignments to `exports` and drops the local name, so the rest of the file, which
// still names the variable, would find nothing there; a name in an export list keeps its local
// binding in every output, and nothing in the source moves.
//
export function exportedCopy(sourceFile: ts.SourceFile, factory: ts.NodeFactory): ts.SourceFile {
    const taken = exportedNames(sourceFile);
    const listed: string[] = [];
    const statements = sourceFile.statements.map((statement) => {
        if (!isExportable(statement)) {
            return statement;
        }
        if (declaredNames(statement).some((name) => taken.has(name))) {
            return statement;
        }
        if (ts.isVariableStatement(statement)) {
            listed.push(...declaredNames(statement));
            return statement;
        }
        return withExport(statement, factory);
    });
    assert.equal(statements.length, sourceFile.statements.length);
    if (listed.length === 0) {
        return factory.updateSourceFile(sourceFile, statements);
    }
    const list = factory.createExportDeclaration(
        undefined,
        false,
        factory.createNamedExports(listed.map((name) => factory.createExportSpecifier(false, undefined, name))),
        undefined,
        undefined,
    );
    return factory.updateSourceFile(sourceFile, [...statements, list]);
}

//
// Whether a statement is a declaration of the file's own that the file keeps to itself: a named
// function, a named class or a variable statement, with no `export` and no `declare`. A `declare`
// has nothing at run time to export.
//
export function isExportable(statement: ts.Statement): boolean {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        if (statement.name === undefined) {
            return false;
        }
    }
    else {
        if (!ts.isVariableStatement(statement)) {
            return false;
        }
    }
    const modifiers = ts.getModifiers(statement) ?? [];
    return !modifiers.some((modifier) => {
        return modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DeclareKeyword;
    });
}

//
// The names a function, class or variable statement declares. A variable statement can destructure,
// so every name bound anywhere in its patterns is read.
//
export function declaredNames(statement: ts.Statement): string[] {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
        assert(statement.name !== undefined);
        return [statement.name.text];
    }
    assert(ts.isVariableStatement(statement));
    const names: string[] = [];
    const pending: ts.BindingName[] = statement.declarationList.declarations.map((declaration) => declaration.name);
    // Each turn takes one binding off the list and adds only the bindings written inside it, so the
    // loop ends once every binding in the statement has been read.
    while (pending.length > 0) {
        const binding = pending.pop();
        assert(binding !== undefined);
        if (ts.isIdentifier(binding)) {
            names.push(binding.text);
        }
        else {
            for (const element of binding.elements) {
                if (!ts.isOmittedExpression(element)) {
                    pending.push(element.name);
                }
            }
        }
    }
    return names;
}

//
// Every name the file exports as it is written: the names of exported declarations, `default` for
// a default export, and the names an `export { ... }` list gives.
//
export function exportedNames(sourceFile: ts.SourceFile): Set<string> {
    const names = new Set<string>();
    for (const statement of sourceFile.statements) {
        if (ts.isExportAssignment(statement)) {
            names.add("default");
        }
        else {
            if (ts.isExportDeclaration(statement)) {
                if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
                    for (const specifier of statement.exportClause.elements) {
                        names.add(specifier.name.text);
                    }
                }
            }
            else {
                addDeclarationExports(statement, names);
            }
        }
    }
    return names;
}

//
// Adds the names a declaration written with `export` gives the file: its own names, or `default`
// when it is written with `export default`.
//
export function addDeclarationExports(statement: ts.Statement, names: Set<string>): void {
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        return;
    }
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        names.add("default");
        return;
    }
    // Only a declaration that is still there at run time can clash. An exported interface or type
    // leaves nothing behind, so a constant of the same name can still be exported.
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isVariableStatement(statement)) {
        for (const name of declaredNames(statement)) {
            names.add(name);
        }
    }
}

//
// The statement with `export` put first among its modifiers, ahead of `async` and any decorator,
// which is the one place the language allows it.
//
export function withExport(statement: ts.Statement, factory: ts.NodeFactory): ts.Statement {
    assert(isExportable(statement));
    const exportKeyword = factory.createModifier(ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement)) {
        // TypeScript's CommonJS output writes `exports.name = name` for a function it reads as
        // exported from the function's original node, which has no `export`. Cut off from that node,
        // the function is read as it is here. Its place in the source is its own, so the source map
        // is unchanged.
        const updated = factory.updateFunctionDeclaration(
            statement,
            [exportKeyword, ...(statement.modifiers ?? [])],
            statement.asteriskToken,
            statement.name,
            statement.typeParameters,
            statement.parameters,
            statement.type,
            statement.body,
        );
        return ts.setOriginalNode(updated, undefined);
    }
    assert(ts.isClassDeclaration(statement), "Only a function or a class is exported with `export` in front of it.");
    return factory.updateClassDeclaration(
        statement,
        [exportKeyword, ...(statement.modifiers ?? [])],
        statement.name,
        statement.typeParameters,
        statement.heritageClauses,
        statement.members,
    );
}
