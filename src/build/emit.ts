// Writes the copy of the project the run loads into the work directory.
//
// The copy is your source with its types taken out and a map back to what it came from. No counter
// is put into it: V8 says what ran, over this copy, and the map turns that back into your lines.
//
// This is the one place a run writes anything at all, and it is never inside the repository being
// measured. A run that is killed halfway leaves the repository exactly as it found it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { shimFor } from "../effects/shims/index.ts";
import { realNow } from "../effects/globals.ts";
import { pathsIn, type PathSite, type Unseen } from "../discover/paths.ts";

// What the emit produced.
export interface Emitted {
    // The directory everything was written into.
    work: string;

    // Where each source file's rewritten copy went, by the file's path relative to the root.
    modules: Map<string, string>;

    // The code paths found, by the file's path relative to the root.
    paths: Map<string, PathSite[]>;

    // The branches V8 reports no count for, put together.
    unseen: Unseen[];

    // The text of each copy, by the file's path relative to the root. The map inside it is what
    // turns a place V8 reported into a place in your source.
    written: Map<string, string>;
}

// What the emit is told.
export interface EmitOptions {
    // The directory the project lives in.
    root: string;

    // The program every file is taken from.
    program: ts.Program;

    // The options the program was built with.
    options: ts.CompilerOptions;

    // The files whose paths are measured, relative to the root.
    measured: Set<string>;
}

// What the run stands in for a stylesheet, an image or anything else a bundler turns into an
// asset. Node loads none of them, and a project built with a bundler imports them freely.
export const assetStubName = "__faultline-asset.mjs";

// What the copy hands the private declarations of a file out under. A function the file does not
// export cannot be reached from outside it, and a run that only calls the exported ones reaches a
// private function through whatever calls it or never. The copy adds one export holding all of
// them, so your own exports are left exactly as you wrote them.
export const privateHolder = "__flt";

// How a private declaration is named to the driver, which reads it off the holder.
export function exportedAs(name: string): string {
    return `${privateHolder}.${name}`;
}

// The extensions a runtime can load. Anything else a file imports is an asset.
const loadable = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx", ".json", ".node"];

// Whether a specifier names an asset rather than code. A bundler's query, such as `?raw` or `?url`,
// is taken off before the extension is read.
export function namesAnAsset(specifier: string): boolean {
    const withoutQuery = specifier.split("?")[0]!;
    const dot = withoutQuery.lastIndexOf(".");
    const slash = withoutQuery.lastIndexOf("/");
    if (dot < 0 || dot < slash) {
        return false;
    }
    return !loadable.includes(withoutQuery.slice(dot).toLowerCase());
}

// How many runs' work directories are kept. The newest is what the report names, so it has to still
// be there when the run ends, and the few before it are kept so two runs side by side do not take
// each other's away. Everything older is a run somebody has finished reading about.
const keptRuns = 4;

// How recently a work directory has to have been touched to be left alone whatever its age says.
//
// Two runs at once each take away what the other left, and a run whose copies are taken away part
// way through loses them. Ten minutes is longer than a run takes and short enough that what is left
// behind does not build up.
const stillInUse = 600000;

// Takes away what earlier runs left behind.
//
// Every run writes a copy of the project, and nothing was ever removing them. This machine had six
// thousand of them holding eighteen gigabytes before anybody noticed, and a run that fills a disk
// is a run that stops working.
export function removeOldRuns(): void {
    const inside = os.tmpdir();
    let held: string[];
    try {
        held = fs.readdirSync(inside).filter((one) => one.startsWith("faultline-"));
    }
    catch {
        // A machine that will not say what is in its temporary directory keeps what is there.
        return;
    }
    const now = realNow();
    const byAge = held
        .map((one) => path.join(inside, one))
        .map((one) => ({ one, at: madeAt(one) }))
        .filter((held_) => held_.at > 0 && now - held_.at > stillInUse)
        .sort((left, right) => right.at - left.at);
    for (const { one } of byAge.slice(keptRuns)) {
        try {
            fs.rmSync(one, { recursive: true, force: true });
        }
        catch {
            // A directory another run is still writing into is left where it is.
        }
    }
}

// When one work directory was made, or nothing when it cannot be told.
function madeAt(where: string): number {
    try {
        return fs.statSync(where).mtimeMs;
    }
    catch {
        return 0;
    }
}

// Makes a directory for this run outside the repository, so a run writes nothing into the tree it
// is measuring.
export function makeWorkDirectory(root: string): string {
    removeOldRuns();
    const stamp = `${path.basename(root)}-${process.pid}-${Date.now().toString(36)}`;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), `faultline-${stamp}-`));
    const modules = path.join(root, "node_modules");
    if (fs.existsSync(modules)) {
        // The rewritten copies import the same packages the project does, and a link at the top of
        // the work directory is what lets the loader find them from there.
        try {
            fs.symlinkSync(modules, path.join(work, "node_modules"), "junction");
        }
        catch {
            // A machine that refuses links still runs everything that imports no package, which is
            // better than refusing the whole run.
        }
    }
    fs.writeFileSync(path.join(work, "package.json"), '{ "type": "module" }\n');
    // A stylesheet or an image imported by the code under test stands in as an empty module, so a
    // project built with a bundler runs here without its bundler.
    fs.writeFileSync(path.join(work, assetStubName), "export default {};\n");
    return work;
}

// Writes the rewritten copy of every file the program holds under the root.
export function emit(options: EmitOptions): Emitted {
    const work = makeWorkDirectory(options.root);
    const modules = new Map<string, string>();
    const paths = new Map<string, PathSite[]>();
    const written = new Map<string, string>();
    const unseen: Unseen[] = [];

    const wanted = options.program
        .getSourceFiles()
        .filter((one) => !one.isDeclarationFile && isUnder(options.root, one.fileName))
        .filter((one) => !one.fileName.includes("/node_modules/"));

    for (const source of wanted) {
        const relative = toRelative(options.root, source.fileName);
        modules.set(relative, path.join(work, moduleNameFor(relative)));
    }

    for (const source of wanted) {
        const relative = toRelative(options.root, source.fileName);
        const target = modules.get(relative)!;
        if (options.measured.has(relative)) {
            const found = pathsIn(source, relative);
            paths.set(relative, found.paths);
            unseen.push(...found.unseen);
        }
        const js = transpile(source.text, source.fileName, options.options);
        const pointed = rewriteSpecifiers(js, target, source.fileName, work, options, modules);
        const reachable = exportEverything(pointed, target);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, reachable);
        written.set(relative, reachable);
    }

    return { work, modules, paths, written, unseen };
}

// Turns one file's text into the JavaScript the run loads. Nothing is checked here: the checker
// has already said what it has to say, and a project with a type error still has paths to run.
export function transpile(text: string, fileName: string, options: ts.CompilerOptions): string {
    const result = ts.transpileModule(text, {
        fileName,
        reportDiagnostics: false,
        compilerOptions: {
            ...options,
            // The loader is Node, which runs modules, so this is fixed here whatever the project
            // compiles to for its own release.
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            target: ts.ScriptTarget.ES2022,
            // The map is how a place V8 reported in the copy becomes a place in your source, and
            // it is also what makes an error thrown by code under test name the line somebody
            // wrote. It is carried inside the file so there is one file to load rather than two.
            sourceMap: false,
            inlineSourceMap: true,
            inlineSources: true,
            declaration: false,
            noEmit: false,
            verbatimModuleSyntax: false,
            isolatedModules: true,
        },
    });
    return result.outputText;
}

// Adds an export for every top level declaration the file kept to itself, so a run can call a
// function the file does not export rather than waiting for something else to call it.
//
// The line is added at the end rather than an `export` being put in front of each declaration,
// because putting one in front would move every character after it and the map back to your source
// is what says which line ran.
export function exportEverything(js: string, emittedAt: string): string {
    const parsed = ts.createSourceFile(emittedAt, js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const kept: string[] = [];

    for (const statement of parsed.statements) {
        if (isExported(statement)) {
            continue;
        }
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name !== undefined) {
            kept.push(statement.name.text);
            continue;
        }
        if (ts.isVariableStatement(statement)) {
            for (const declared of statement.declarationList.declarations) {
                if (ts.isIdentifier(declared.name)) {
                    kept.push(declared.name.text);
                }
            }
        }
    }

    if (kept.length === 0) {
        return js;
    }
    const added = `export const ${privateHolder} = { ${kept.join(", ")} };\n`;
    // The map the transpile wrote sits on the last line of the file and has to stay there, so the
    // line goes in ahead of it.
    const marker = js.lastIndexOf("//# sourceMappingURL=");
    if (marker < 0) {
        return `${js}\n${added}`;
    }
    return `${js.slice(0, marker)}${added}${js.slice(marker)}`;
}

// Whether a statement carries the `export` keyword.
function isExported(statement: ts.Statement): boolean {
    return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((one) => one.kind === ts.SyntaxKind.ExportKeyword);
}

// Points every import at the rewritten copy of what it named, so the run loads the copies rather
// than the originals.
export function rewriteSpecifiers(
    js: string,
    emittedAt: string,
    originalFile: string,
    work: string,
    options: EmitOptions,
    modules: Map<string, string>,
): string {
    const parsed = ts.createSourceFile(emittedAt, js, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const changes: { start: number; end: number; text: string }[] = [];

    function visit(node: ts.Node): void {
        const specifier = specifierOf(node);
        if (specifier !== undefined) {
            const replacement = pointAt(specifier.text, emittedAt, originalFile, work, options, modules);
            if (replacement !== undefined) {
                // The quotes are left where they are and only what is between them is replaced, so
                // a specifier written with either quote comes out written the same way.
                changes.push({ start: specifier.getStart(parsed) + 1, end: specifier.getEnd() - 1, text: replacement });
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(parsed);
    let out = js;
    for (const change of changes.sort((left, right) => right.start - left.start)) {
        out = out.slice(0, change.start) + change.text + out.slice(change.end);
    }
    return out;
}

// The string a node names a module with, or nothing when it names none.
function specifierOf(node: ts.Node): ts.StringLiteralLike | undefined {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const found = node.moduleSpecifier;
        if (found !== undefined && ts.isStringLiteralLike(found)) {
            return found;
        }
        return undefined;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const first = node.arguments[0];
        if (first !== undefined && ts.isStringLiteralLike(first)) {
            return first;
        }
    }
    return undefined;
}

// What a specifier has to become, or nothing when it is already right.
function pointAt(
    specifier: string,
    emittedAt: string,
    originalFile: string,
    work: string,
    options: EmitOptions,
    modules: Map<string, string>,
): string | undefined {
    if (namesAnAsset(specifier)) {
        return relativeSpecifier(emittedAt, path.join(work, assetStubName));
    }
    const shim = shimFor(specifier);
    if (shim !== undefined) {
        // A built in module the run replaces. The code under test imports it the way it always did
        // and gets the run's own, so a failed read is exercised without the project declaring
        // anything.
        return pathToFileURL(shim).href;
    }
    const resolved = ts.resolveModuleName(specifier, originalFile, options.options, ts.sys).resolvedModule;
    const target = resolved?.resolvedFileName;
    if (target === undefined) {
        // A specifier that resolves to no file is a package, and the link at the top of the work
        // directory is what finds it.
        return undefined;
    }
    const relative = toRelative(options.root, target);
    const copied = modules.get(relative);
    if (copied !== undefined) {
        return relativeSpecifier(emittedAt, copied);
    }
    if (specifier.startsWith(".")) {
        // Something the project names by path and the run did not copy, such as a file outside the
        // root. It is loaded where it already is.
        return pathToFileURL(target).href;
    }
    return undefined;
}

// One emitted file's path from another, written the way a module specifier has to be.
export function relativeSpecifier(from: string, to: string): string {
    const between = path.relative(path.dirname(from), to).split(path.sep).join("/");
    if (between.startsWith(".")) {
        return between;
    }
    return `./${between}`;
}

// Where a file's rewritten copy goes, which mirrors the project's own tree so a relative import
// still points at what it pointed at.
export function moduleNameFor(relative: string): string {
    const dot = relative.lastIndexOf(".");
    const stem = dot < 0 ? relative : relative.slice(0, dot);
    return `${stem}.mjs`;
}

// Whether a file is inside the root. The run copies the ones that are.
export function isUnder(root: string, file: string): boolean {
    const between = path.relative(root, file);
    return between !== "" && !between.startsWith("..") && !path.isAbsolute(between);
}

// A file's path relative to the root, written the one way.
export function toRelative(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join("/");
}
