//
// Builds the TypeScript programs a run reads its types from: one per `tsconfig.json` that owns a
// source file.
//
// The `tsconfig.json` nearest a file decides its options, so a run reads the same types the
// project's own editor does, and a monorepo whose packages each have their own options reads each
// package with its own.
//

import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import type { IFileSystem } from "../lib/file-system.ts";
import { knownIsDirectory, knownIsFile, knownListing, knownRealPath, knownText, untilKnown, type IKnownFiles, type IReading } from "../lib/known-files.ts";

//
// A program over the files a run measures, and the options it was built with.
//
export interface IBuiltProgram {
    //
    // What the run reads each file's syntax and diagnostics from.
    //
    program: ts.Program;

    //
    // The checker every type is read through.
    //
    checker: ts.TypeChecker;

    //
    // The options the program was built with, which the emit reuses so both read the same modules.
    //
    options: ts.CompilerOptions;
}

//
// The options a run uses where the project supplies none. None of them changes what a value is at
// run time, because the emit is a transpile: they decide only what the checker can see. JavaScript
// is allowed and checking is loose so a project with no config of its own still has every file
// read, and `noEmit` holds because a run never writes the project's output.
//
export const optionsDefault: ts.CompilerOptions = {
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

//
// The programs over every file of a run, one per `tsconfig.json` that owns one of them.
//
export interface IProjectPrograms {
    //
    // Each program, by the path of the `tsconfig.json` it was built with, or by the empty string
    // for the files no `tsconfig.json` in the project owns.
    //
    byConfig: Map<string, IBuiltProgram>;

    //
    // The key into `byConfig` of the program each file was read in, by the file's absolute path.
    //
    owners: Map<string, string>;
}

//
// The `tsconfig.json` that owns a file: the nearest one in the file's directory or a directory
// above it, up to the project root and no further. A `tsconfig.json` above the root belongs to
// some other project. It is undefined when no directory up to the root has one.
//
export async function ownerConfig(fileSystem: IFileSystem, root: string, file: string): Promise<string | undefined> {
    const top = path.resolve(root);
    assert.ok(path.isAbsolute(file), `${file} is not an absolute path.`);
    assert.ok(file.startsWith(`${top}${path.sep}`), `${file} is outside the project root ${top}.`);
    const steps = path.relative(top, path.dirname(file)).split(path.sep).filter((step) => step.length > 0);
    assert.ok(!steps.includes(".."));
    for (let depth = steps.length; depth >= 0; depth -= 1) {
        const candidate = path.join(top, ...steps.slice(0, depth), "tsconfig.json");
        if (await fileSystem.isFile(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

//
// Builds one program per `tsconfig.json` that owns one of `files`, which are absolute paths, each
// program over the files it owns. The owners are looked up all at once, because each lookup waits
// on the file system.
//
export async function buildPrograms(reading: IReading, root: string, files: string[]): Promise<IProjectPrograms> {
    assert.ok(path.isAbsolute(root), `${root} is not an absolute path.`);
    const configs = await Promise.all(files.map((file) => ownerConfig(reading.fileSystem, root, file)));
    const grouped = new Map<string, string[]>();
    const owners = new Map<string, string>();
    for (const [index, file] of files.entries()) {
        const key = configs[index] ?? "";
        owners.set(file, key);
        const group = grouped.get(key);
        if (!group) {
            grouped.set(key, [file]);
        }
        else {
            group.push(file);
        }
    }
    const byConfig = new Map<string, IBuiltProgram>();
    for (const [key, owned] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        byConfig.set(key, await buildProgram(reading, key === "" ? undefined : key, owned));
    }
    assert.equal(owners.size, new Set(files).size);
    assert.ok(byConfig.size <= files.length);
    return {
        byConfig,
        owners,
    };
}

//
// The program a file was read in.
//
export function ownerProgram(programs: IProjectPrograms, file: string): IBuiltProgram {
    const key = programs.owners.get(file);
    assert.ok(key !== undefined, `${file} is in no program of this run.`);
    const built = programs.byConfig.get(key);
    assert.ok(built);
    return built;
}

//
// Reads a `tsconfig.json`, or hands back the defaults for a file no `tsconfig.json` owns. The
// config and every config it extends are read ahead into `reading`, because the compiler reads
// them synchronously and cannot wait for the file system.
//
export async function readCompilerOptions(reading: IReading, configFile: string | undefined): Promise<ts.CompilerOptions> {
    let options: ts.CompilerOptions;
    if (configFile) {
        options = await untilKnown(reading, () => parseOptions(reading.known, configFile));
    }
    else {
        options = {
            ...optionsDefault,
        };
    }
    assert.equal(options.noEmit, true);
    assert.equal(options.allowJs, true);
    assert.equal(reading.known.misses.length, 0);
    return options;
}

//
// The options a `tsconfig.json` gives, read from what is known, or the defaults when it cannot be
// read or parsed. A config that will not parse falls back rather than stopping the run, because
// the project's own build reports that error and the run still has code paths to exercise.
//
export function parseOptions(known: IKnownFiles, configFile: string): ts.CompilerOptions {
    assert.ok(path.isAbsolute(configFile), `${configFile} is not an absolute path.`);
    const read = ts.readConfigFile(configFile, (file: string) => knownText(known, file));
    if (read.error) {
        return {
            ...optionsDefault,
        };
    }

    //
    // The config's own path goes with its options, so the compiler looks for type packages beside
    // it rather than in the directory the run started in.
    //
    const parsed = ts.parseJsonConfigFileContent(read.config, parseConfigHost(known), path.dirname(configFile), undefined, configFile);
    assert.equal(parsed.options.configFilePath, configFile);
    return {
        ...parsed.options,

        //
        // A run never writes the project's own output, so whatever the project emits is turned off
        // and the run's own transpile decides how each file is written.
        //
        noEmit: true,
        declaration: false,
        composite: false,
        incremental: false,
        allowJs: true,
        skipLibCheck: true,
    };
}

//
// The TypeScript files under a `tsconfig.json`'s directory that declare something for every file of
// the project: a `declare global` block, or a `declare module` that adds to a package's types, as a
// file adding the signed-in user to an Express request does. The project's own build reads every
// file the config names, so those declarations hold in every file it checks. A shard's program
// holds only the files a shard imports, so these are added to it, or a sim file using what they
// declare is reported with errors the project's build does not have.
//
// The files are found by walking the config's directory, skipping `node_modules` and directories
// whose name starts with a dot, rather than by the config's `include`, because the compiler's own
// matching of those patterns is not part of its public interface. A file the config leaves out
// is taken in only when it declares something for every file itself.
//
export function augmentingFiles(known: IKnownFiles, configFile: string): string[] {
    assert.ok(path.isAbsolute(configFile), `${configFile} is not an absolute path.`);
    const found: string[] = [];
    const waiting = [path.dirname(configFile)];
    let visited = 0;
    while (waiting.length > 0) {
        visited += 1;
        assert(visited <= directoriesMost, `${path.dirname(configFile)} holds more than ${directoriesMost} directories outside node_modules.`);
        const directory = waiting.pop();
        assert(directory !== undefined);
        for (const entry of knownListing(known, directory)) {
            if (entry.kind === "directory") {
                if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
                    waiting.push(path.join(directory, entry.name));
                }
                continue;
            }
            if (entry.kind === "file" && /\.[cm]?tsx?$/.test(entry.name)) {
                found.push(path.join(directory, entry.name));
            }
        }
    }
    return found.filter((file) => isAugmenting(knownText(known, file) ?? ""));
}

//
// The most directories `augmentingFiles` walks under one config. A project's own source, outside
// its packages, has hundreds at most, so a walk that reaches this many has followed something it
// should not have.
//
export const directoriesMost = 100000;

//
// Whether a file's text declares something for every file: a `declare global` or a `declare
// module` block.
//
export function isAugmenting(text: string): boolean {
    return /\bdeclare\s+(global|module)\b/.test(text);
}

//
// Builds the program over `files`, which are absolute paths, with the options of `configFile`,
// reading every file the compiler follows ahead into `reading`.
//
export async function buildProgram(reading: IReading, configFile: string | undefined, files: string[]): Promise<IBuiltProgram> {
    assert.ok(files.every((file) => path.isAbsolute(file)), "Every file a program is built over has an absolute path.");
    const options = await readCompilerOptions(reading, configFile);
    assert.equal(options.noEmit, true);
    const program = await untilKnown(reading, () => ts.createProgram({
        rootNames: files,
        options,
        host: createCompilerHost(reading.known),
    }));
    assert.ok(files.every((file) => program.getRootFileNames().includes(file)));
    return {
        program,
        checker: program.getTypeChecker(),
        options,
    };
}

//
// The names of the directories in a directory, as the compiler asks for them when it looks for
// type packages.
//
export function directoryNames(known: IKnownFiles, directory: string): string[] {
    assert.ok(path.isAbsolute(directory), `The compiler listed ${directory}, which is not an absolute path.`);
    const names = knownListing(known, directory).filter((entry) => entry.kind === "directory").map((entry) => entry.name);
    assert.ok(names.every((name) => name.length > 0));
    return names;
}

//
// What the compiler resolves a module with, answered from what is known, because module
// resolution runs synchronously and cannot wait for the file system.
//
export function moduleResolutionHost(known: IKnownFiles): ts.ModuleResolutionHost {
    return {
        fileExists: (file: string) => {
            assert.ok(path.isAbsolute(file));
            return knownIsFile(known, file);
        },
        readFile: (file: string) => {
            assert.ok(path.isAbsolute(file));
            return knownText(known, file);
        },
        directoryExists: (directory: string) => {
            assert.ok(path.isAbsolute(directory));
            return knownIsDirectory(known, directory);
        },
        realpath: (file: string) => {
            assert.ok(path.isAbsolute(file));
            return knownRealPath(known, file);
        },
        getDirectories: (directory: string) => directoryNames(known, directory),
        getCurrentDirectory: () => process.cwd(),
        useCaseSensitiveFileNames: true,
    };
}

//
// What the compiler reads a `tsconfig.json` with, answered from what is known. Only the options
// are taken from a config, never the files it lists, so no directory is read for them.
//
export function parseConfigHost(known: IKnownFiles): ts.ParseConfigHost {
    return {
        useCaseSensitiveFileNames: true,
        readDirectory: () => [],
        fileExists: (file: string) => {
            assert.ok(path.isAbsolute(file));
            return knownIsFile(known, file);
        },
        readFile: (file: string) => {
            assert.ok(path.isAbsolute(file));
            return knownText(known, file);
        },
    };
}

//
// The parsed file at `file` from what is known, or undefined when it is not a readable file or has
// not been read yet. Each file is parsed once per language version and module format and kept,
// because the compiler asks again in every round and parsing is the slow part. The format is part
// of the key because the compiler works it out from the nearest `package.json`, which an early
// round may not have read yet, and a file parsed as CommonJS then would be kept as CommonJS.
//
export function knownSource(known: IKnownFiles, file: string, languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions): ts.SourceFile | undefined {
    assert.ok(path.isAbsolute(file), `The compiler asked to parse ${file}, which is not an absolute path.`);
    const version = typeof languageVersion === "object" ? languageVersion.languageVersion : languageVersion;
    const format = typeof languageVersion === "object" ? languageVersion.impliedNodeFormat ?? "" : "";
    const key = `${version}\0${format}\0${file}`;
    const held = known.parsed.get(key);
    if (held) {
        return held;
    }
    const text = knownText(known, file);

    //
    // An empty file is still a file, so only a file that could not be read has no source.
    //
    if (text === undefined) {
        return undefined;
    }
    const source = ts.createSourceFile(file, text, languageVersion, true);
    assert.equal(source.fileName, file);
    known.parsed.set(key, source);
    return source;
}

//
// The compiler host a program is built with, answering every read, the library's own included,
// from what is known. A program never writes, so writing a file is a defect in Faultline. JSDoc in
// TypeScript files is parsed only where a type error needs it, as `tsc` does, because Faultline
// reads types from the syntax and parsing every comment of the library takes most of a run's time.
//
export function createCompilerHost(known: IKnownFiles): ts.CompilerHost {
    return {
        jsDocParsingMode: ts.JSDocParsingMode.ParseForTypeErrors,
        getSourceFile: (file: string, languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions): ts.SourceFile | undefined => knownSource(known, file, languageVersion),
        getDefaultLibFileName: (libraryOptions: ts.CompilerOptions) => ts.getDefaultLibFilePath(libraryOptions),
        writeFile: (file: string): void => {
            assert.fail(`The compiler tried to write ${file}, and a program Faultline builds never writes.`);
        },
        getCurrentDirectory: () => process.cwd(),
        getCanonicalFileName: (file: string) => file,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        readFile: (file: string) => {
            assert.ok(path.isAbsolute(file));
            return knownText(known, file);
        },
        fileExists: (file: string) => {
            assert.ok(path.isAbsolute(file));
            return knownIsFile(known, file);
        },
        realpath: (file: string) => {
            assert.ok(path.isAbsolute(file));
            return knownRealPath(known, file);
        },
        getDirectories: (directory: string) => directoryNames(known, directory),
        directoryExists: (directory: string) => {
            assert.ok(path.isAbsolute(directory));
            return knownIsDirectory(known, directory);
        },
    };
}

//
// The errors that stop a run: the files that will not parse, each written with where it is. Type
// errors are left alone, because a project with a type error still has code paths to exercise.
//
export function syntaxErrors(program: ts.Program, root: string): string[] {
    assert.ok(path.isAbsolute(root), `${root} is not an absolute path.`);
    const diagnostics = program.getSyntacticDiagnostics();
    const found = diagnostics.map((diagnostic) => formatDiagnostic(diagnostic, root));
    assert.equal(found.length, diagnostics.length);
    return found;
}

//
// One diagnostic written the way the compiler writes it, with the path relative to the root.
//
export function formatDiagnostic(diagnostic: ts.Diagnostic, root: string): string {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    assert.ok(message.length > 0);
    const file = diagnostic.file;
    if (!file) {
        return message;
    }
    const start = diagnostic.start;
    if (start === undefined) {
        return message;
    }
    const position = file.getLineAndCharacterOfPosition(start);
    assert.ok(position.line >= 0);
    return `${path.relative(root, file.fileName)}:${position.line + 1}:${position.character + 1}: ${message}`;
}
