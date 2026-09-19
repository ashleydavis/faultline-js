// Builds the TypeScript program a run reads its types from.
//
// The project's own `tsconfig.json` decides the options where there is one, so a run reads the
// same types the project's own editor does.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { configSystem, projectHost } from "./disk.ts";

// A program over the files a run measures, and the options it was built with.
export interface BuiltProgram {
    // The program itself.
    program: ts.Program;

    // The checker every type is read through.
    checker: ts.TypeChecker;

    // The options the program was built with, which the emit reuses so both read the same modules.
    options: ts.CompilerOptions;
}

// The options a run uses where the project supplies none. Nothing here changes what a value is at
// run time: the emit is a transpile, and these only decide what the checker can see.
export const defaultOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
    strict: false,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    resolveJsonModule: true,
};

// Reads the project's `tsconfig.json`, or hands back the defaults above when it has none.
export function optionsFor(root: string): ts.CompilerOptions {
    const configFile = ts.findConfigFile(root, configSystem.fileExists, "tsconfig.json");
    if (configFile === undefined) {
        return { ...defaultOptions };
    }
    const read = ts.readConfigFile(configFile, configSystem.readFile);
    if (read.error !== undefined) {
        return { ...defaultOptions };
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, configSystem, path.dirname(configFile));
    return {
        ...parsed.options,
        // A run never writes the project's own output, so whatever the project emits is turned off
        // here and the transpile below decides the rest.
        noEmit: true,
        declaration: false,
        composite: false,
        incremental: false,
        allowJs: true,
        skipLibCheck: true,
    };
}

// Builds the program over `files`, which are absolute paths.
export function buildProgram(root: string, files: string[]): BuiltProgram {
    const options = optionsFor(root);
    const program = ts.createProgram({ rootNames: files, options, host: projectHost(options) });
    return { program, checker: program.getTypeChecker(), options };
}

// The errors that stop a run: a file that will not parse, or a module the project imports and the
// run has no path for. Type errors are left alone, because a project with a type error still has
// code paths to exercise.
export function stoppingErrors(program: ts.Program, root: string): string[] {
    const found: string[] = [];
    for (const diagnostic of program.getSyntacticDiagnostics()) {
        found.push(formatDiagnostic(diagnostic, root));
    }
    return found;
}

// One diagnostic written the way the compiler writes it, with the path relative to the root.
export function formatDiagnostic(diagnostic: ts.Diagnostic, root: string): string {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    const file = diagnostic.file;
    if (file === undefined || diagnostic.start === undefined) {
        return message;
    }
    const at = file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${path.relative(root, file.fileName)}:${at.line + 1}:${at.character + 1}: ${message}`;
}

// Whether the project is written as modules. A run loads modules and nothing besides. A project whose
// `package.json` says otherwise is told so rather than left to fail one call at a time.
export function isModuleProject(root: string): boolean {
    const manifest = path.join(root, "package.json");
    if (!fs.existsSync(manifest)) {
        // A directory with no manifest is taken as modules. That is how a TypeScript file in a
        // directory of its own is nearly always written as.
        return true;
    }
    try {
        const read = JSON.parse(fs.readFileSync(manifest, "utf8")) as { type?: string };
        return read.type !== "commonjs";
    }
    catch {
        return true;
    }
}
