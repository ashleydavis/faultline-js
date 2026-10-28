//
// Lets a scenario start a project file as the process's entry point, by having every reading of
// `import.meta.main` in the copy Faultline loads also ask the run whether this file was started.
//
// Node sets `import.meta.main` only for the file it was started with, which in a run is Faultline's
// own child, so a file that runs its work only when it is the entry point would never run it. The
// reading is rewritten as `(globalThis.<check>?.(import.meta.url) || import.meta.main)`, built from
// syntax nodes, and keeps the place it had in the source, so the source map is unchanged.
//

import assert from "node:assert/strict";
import ts from "typescript";
import { entryCheckName } from "../world/globals.ts";

//
// The transformer the transpile is given.
//
export function checkEntryPoint(context: ts.TransformationContext): ts.Transformer<ts.SourceFile> {
    assert(context.factory !== undefined);
    return (sourceFile: ts.SourceFile): ts.SourceFile => {
        const visit = (node: ts.Node): ts.Node => {
            if (isImportMetaMain(node)) {
                return ts.setTextRange(entryReading(context.factory), node);
            }
            return ts.visitEachChild(node, visit, context);
        };
        const visited = ts.visitNode(sourceFile, visit);
        assert(ts.isSourceFile(visited));
        return visited;
    };
}

//
// Whether a node reads `import.meta.main`.
//
export function isImportMetaMain(node: ts.Node): boolean {
    if (!ts.isPropertyAccessExpression(node)) {
        return false;
    }
    if (!ts.isMetaProperty(node.expression)) {
        return false;
    }
    if (node.expression.keywordToken !== ts.SyntaxKind.ImportKeyword) {
        return false;
    }
    return node.name.text === "main";
}

//
// The expression a reading of `import.meta.main` becomes: true when the run says this file was
// started as the entry point, and what Node says otherwise.
//
export function entryReading(factory: ts.NodeFactory): ts.Expression {
    const importMeta = (): ts.MetaProperty => factory.createMetaProperty(ts.SyntaxKind.ImportKeyword, factory.createIdentifier("meta"));
    const asked = factory.createCallChain(
        factory.createPropertyAccessExpression(factory.createIdentifier("globalThis"), entryCheckName),
        factory.createToken(ts.SyntaxKind.QuestionDotToken),
        undefined,
        [factory.createPropertyAccessExpression(importMeta(), "url")],
    );
    const reading = factory.createParenthesizedExpression(factory.createBinaryExpression(
        asked,
        ts.SyntaxKind.BarBarToken,
        factory.createPropertyAccessExpression(importMeta(), "main"),
    ));
    assert(ts.isParenthesizedExpression(reading));
    return reading;
}
