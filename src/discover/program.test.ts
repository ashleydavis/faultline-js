//
// Tests how the programs a run reads its types from are built: which `tsconfig.json` owns which
// file, one program per owner, the options each program is built with and the hosts the compiler
// reads every file through. Each test puts a small project in a file system in memory, or puts the
// answers straight into what is known, so no test reads the disk.
//

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import { createFakeFileSystem, createFakeProject, projectRoot } from "../lib/fake-files.test.ts";
import { createKnownFiles, createReading, untilKnown } from "../lib/known-files.ts";
import { fixture } from "./fixture.test.ts";
import {
    augmentingFiles,
    buildProgram,
    buildPrograms,
    createCompilerHost,
    directoryNames,
    formatDiagnostic,
    isAugmenting,
    knownSource,
    moduleResolutionHost,
    optionsDefault,
    readCompilerOptions,
    ownerConfig,
    ownerProgram,
    parseConfigHost,
    parseOptions,
    syntaxErrors,
} from "./program.ts";

//
// The path of `file` in the project in memory.
//
export function projectPath(file: string): string {
    return path.join(projectRoot, file);
}

describe("readCompilerOptions", () => {
    test("a project with no config of its own gets the defaults", async () => {
        const options = await readCompilerOptions(createReading(createFakeFileSystem({})), undefined);
        assert.deepEqual(options, optionsDefault);
        assert.notEqual(options, optionsDefault);
    });

    test("a project's own config decides the options", async () => {
        const reading = createReading(createFakeProject({
            "a.ts": "export const a = 1;",
            "tsconfig.json": '{ "compilerOptions": { "strict": true, "target": "ES2020" } }',
        }));
        const options = await readCompilerOptions(reading, projectPath("tsconfig.json"));
        assert.equal(options.strict, true);
        assert.equal(options.target, ts.ScriptTarget.ES2020);
        assert.equal(options.configFilePath, projectPath("tsconfig.json"));
        assert.equal(reading.known.misses.length, 0);
    });

    test("a config that extends another reads the other through the same file system", async () => {
        const reading = createReading(createFakeProject({
            "base.json": '{ "compilerOptions": { "strict": true } }',
            "tsconfig.json": '{ "extends": "./base.json" }',
        }));
        assert.equal((await readCompilerOptions(reading, projectPath("tsconfig.json"))).strict, true);
        assert.equal(reading.known.texts.get(projectPath("base.json")), '{ "compilerOptions": { "strict": true } }');
    });

    test("whatever the project emits for itself is turned off, because a run writes none of it", async () => {
        const reading = createReading(createFakeProject({
            "a.ts": "export const a = 1;",
            "tsconfig.json": '{ "compilerOptions": { "declaration": true, "composite": true, "outDir": "dist" } }',
        }));
        const options = await readCompilerOptions(reading, projectPath("tsconfig.json"));
        assert.equal(options.noEmit, true);
        assert.equal(options.declaration, false);
        assert.equal(options.composite, false);
    });

    test("a config that will not parse falls back to the defaults rather than stopping the run", async () => {
        const reading = createReading(createFakeProject({
            "a.ts": "export const a = 1;",
            "tsconfig.json": "{ this is not json",
        }));
        const options = await readCompilerOptions(reading, projectPath("tsconfig.json"));
        assert.deepEqual(options, optionsDefault);
        assert.equal(reading.known.texts.get(projectPath("tsconfig.json")), "{ this is not json");
    });

    test("a config that cannot be read falls back to the defaults", async () => {
        const files = createFakeProject({});
        files.failNext(projectPath("tsconfig.json"), "EACCES");
        const reading = createReading(files);
        assert.deepEqual(await readCompilerOptions(reading, projectPath("tsconfig.json")), optionsDefault);
        assert.equal(reading.known.texts.get(projectPath("tsconfig.json")), undefined);
    });
});

describe("parseOptions", () => {
    test("a config that has not been read yet is asked for and the defaults stand in for it", () => {
        const known = createKnownFiles();
        assert.deepEqual(parseOptions(known, projectPath("tsconfig.json")), optionsDefault);
        assert.deepEqual(known.misses, [
            {
                kind: "text",
                path: projectPath("tsconfig.json"),
            },
        ]);
    });

    test("a config that has been read gives its own options, with the project's output turned off", () => {
        const known = createKnownFiles();
        known.texts.set(projectPath("tsconfig.json"), '{ "compilerOptions": { "strict": true, "incremental": true } }');
        const options = parseOptions(known, projectPath("tsconfig.json"));
        assert.equal(options.strict, true);
        assert.equal(options.incremental, false);
        assert.equal(options.configFilePath, projectPath("tsconfig.json"));
        assert.deepEqual(known.misses, []);
    });

    test("a config path that is not absolute is a programmer error", () => {
        assert.throws(() => parseOptions(createKnownFiles(), "tsconfig.json"), /not an absolute path/);
    });
});

describe("buildProgram", () => {
    test("a program is built over the files it was given", async () => {
        const reading = createReading(createFakeProject({
            "a.ts": "export const a = 1;",
        }));
        const built = await buildProgram(reading, projectPath("tsconfig.json"), [projectPath("a.ts")]);
        assert.notEqual(built.program.getSourceFile(projectPath("a.ts")), undefined);
        assert.notEqual(built.checker, undefined);
        assert.equal(built.options.noEmit, true);
    });

    test("a program reads its library through the file system and finds none on an empty one", async () => {
        const reading = createReading(createFakeFileSystem({
            [projectPath("a.ts")]: "export const a: Array<number> = [];",
        }));
        const built = await buildProgram(reading, undefined, [projectPath("a.ts")]);
        assert.notEqual(built.program.getSourceFile(projectPath("a.ts")), undefined);
        assert.equal(built.program.getSourceFile(ts.getDefaultLibFilePath(optionsDefault)), undefined);
    });

    test("a file with a path that is not absolute is a programmer error", async () => {
        const reading = createReading(createFakeFileSystem({}));
        await assert.rejects(buildProgram(reading, undefined, ["a.ts"]), /absolute path/);
    });
});

describe("syntaxErrors", () => {
    test("a file that will not parse stops the run", async () => {
        const made = await fixture({
            "a.ts": "export function f( {",
        });
        const found = syntaxErrors(made.built.program, made.root);
        assert.ok(found.length > 0);
        assert.ok(found.every((error) => error.startsWith("a.ts:")));
    });

    test("a type error does not stop the run, because the code still has paths to exercise", async () => {
        const made = await fixture({
            "a.ts": "export const a: number = 'text';",
        });
        const found = syntaxErrors(made.built.program, made.root);
        assert.deepEqual(found, []);
        assert.ok(made.built.program.getSemanticDiagnostics().length > 0);
    });
});

describe("formatDiagnostic", () => {
    test("an error names the file, the line and the column", async () => {
        const made = await fixture({
            "a.ts": "export function f( {",
        });
        const found = syntaxErrors(made.built.program, made.root);
        assert.ok(found.length > 0);
        assert.match(found[0]!, /^a\.ts:\d+:\d+: /);
    });

    test("an error with no file of its own is written as its message alone", () => {
        const written = formatDiagnostic({
            messageText: "said something",
            category: ts.DiagnosticCategory.Error,
            code: 1,
            file: undefined,
            start: undefined,
            length: undefined,
        }, projectRoot);
        assert.equal(written, "said something");
    });

    test("an error in a file with no place in it is written as its message alone", () => {
        const written = formatDiagnostic({
            messageText: "said something",
            category: ts.DiagnosticCategory.Error,
            code: 1,
            file: ts.createSourceFile(projectPath("a.ts"), "", ts.ScriptTarget.ES2022, true),
            start: undefined,
            length: undefined,
        }, projectRoot);
        assert.equal(written, "said something");
    });
});

describe("ownerConfig", () => {
    test("the tsconfig.json nearest a file owns it", async () => {
        const files = createFakeFileSystem({
            [projectPath("tsconfig.json")]: "{}",
            [projectPath("a.ts")]: "",
            [projectPath("packages/one/tsconfig.json")]: "{}",
            [projectPath("packages/one/src/b.ts")]: "",
            [projectPath("packages/two/src/c.ts")]: "",
        });
        assert.equal(await ownerConfig(files, projectRoot, projectPath("a.ts")), projectPath("tsconfig.json"));
        assert.equal(await ownerConfig(files, projectRoot, projectPath("packages/one/src/b.ts")), projectPath("packages/one/tsconfig.json"));
        assert.equal(await ownerConfig(files, projectRoot, projectPath("packages/two/src/c.ts")), projectPath("tsconfig.json"));
    });

    test("a tsconfig.json above the project root owns no file of the project", async () => {
        const files = createFakeFileSystem({
            [projectPath("tsconfig.json")]: "{}",
            [projectPath("project/a.ts")]: "",
        });
        const root = projectPath("project");
        assert.equal(await ownerConfig(files, root, path.join(root, "a.ts")), undefined);
        assert.equal(await ownerConfig(files, projectRoot, path.join(root, "a.ts")), projectPath("tsconfig.json"));
    });

    test("a file outside the project root is a programmer error", async () => {
        await assert.rejects(ownerConfig(createFakeFileSystem({}), projectRoot, projectPath("../elsewhere/a.ts")), /outside the project root/);
        await assert.rejects(ownerConfig(createFakeFileSystem({}), projectRoot, "a.ts"), /not an absolute path/);
    });
});

describe("buildPrograms", () => {
    test("a monorepo gets one program per tsconfig.json, each read with its own options", async () => {
        const reading = createReading(createFakeFileSystem({
            [projectPath("packages/strict/tsconfig.json")]: '{ "compilerOptions": { "strict": true } }',
            [projectPath("packages/strict/a.ts")]: "export const a = 1;",
            [projectPath("packages/strict/b.ts")]: "export const b = 1;",
            [projectPath("packages/loose/tsconfig.json")]: '{ "compilerOptions": { "strict": false, "target": "ES2020" } }',
            [projectPath("packages/loose/c.ts")]: "export const c = 1;",
            [projectPath("loose.ts")]: "export const d = 1;",
        }));
        const roots = ["packages/strict/a.ts", "packages/strict/b.ts", "packages/loose/c.ts", "loose.ts"].map(projectPath);
        const programs = await buildPrograms(reading, projectRoot, roots);
        assert.deepEqual([...programs.byConfig.keys()], ["", projectPath("packages/loose/tsconfig.json"), projectPath("packages/strict/tsconfig.json")]);
        const strict = ownerProgram(programs, roots[0]!);
        assert.equal(strict, ownerProgram(programs, roots[1]!));
        assert.equal(strict.options.strict, true);
        assert.notEqual(strict.program.getSourceFile(roots[1]!), undefined);
        assert.equal(strict.program.getSourceFile(roots[2]!), undefined);
        const loose = ownerProgram(programs, roots[2]!);
        assert.equal(loose.options.target, ts.ScriptTarget.ES2020);
        assert.equal(ownerProgram(programs, roots[3]!).options.strict, optionsDefault.strict);
    });

    test("a run over no files builds no program", async () => {
        const programs = await buildPrograms(createReading(createFakeFileSystem({})), projectRoot, []);
        assert.equal(programs.byConfig.size, 0);
        assert.equal(programs.owners.size, 0);
    });
});

describe("ownerProgram", () => {
    test("asking for the program of a file no program read is a programmer error", async () => {
        const programs = await buildPrograms(createReading(createFakeFileSystem({})), projectRoot, []);
        assert.throws(() => ownerProgram(programs, projectPath("a.ts")), /in no program/);
    });

    test("a file is answered with the program it was read in", async () => {
        const programs = await buildPrograms(createReading(createFakeProject({
            "a.ts": "export const a = 1;",
        })), projectRoot, [projectPath("a.ts")]);
        const built = ownerProgram(programs, projectPath("a.ts"));
        assert.equal(built, programs.byConfig.get(projectPath("tsconfig.json")));
        assert.notEqual(built.program.getSourceFile(projectPath("a.ts")), undefined);
    });
});

describe("directoryNames", () => {
    test("only the directories of a listed directory are named", () => {
        const known = createKnownFiles();
        known.listings.set(projectRoot, [
            {
                name: "lib",
                kind: "directory",
            },
            {
                name: "c.ts",
                kind: "file",
            },
            {
                name: "src",
                kind: "directory",
            },
        ]);
        assert.deepEqual(directoryNames(known, projectRoot), ["lib", "src"]);
        assert.deepEqual(known.misses, []);
    });

    test("a directory not listed yet has none, and is asked for", () => {
        const known = createKnownFiles();
        assert.deepEqual(directoryNames(known, projectPath("missing")), []);
        assert.deepEqual(known.misses, [
            {
                kind: "listing",
                path: projectPath("missing"),
            },
        ]);
    });

    test("a directory with a path that is not absolute is a programmer error", () => {
        assert.throws(() => directoryNames(createKnownFiles(), "src"), /not an absolute path/);
    });
});

describe("moduleResolutionHost", () => {
    test("module resolution answers from what is known and asks for what is not", () => {
        const known = createKnownFiles();
        known.files.set(projectPath("src/a.ts"), true);
        known.texts.set(projectPath("src/a.ts"), "text");
        known.directories.set(projectPath("src"), true);
        known.realPaths.set(projectPath("src/a.ts"), projectPath("src/a.ts"));
        known.listings.set(projectRoot, [
            {
                name: "src",
                kind: "directory",
            },
        ]);
        const host = moduleResolutionHost(known);
        assert.equal(host.fileExists(projectPath("src/a.ts")), true);
        assert.equal(host.readFile(projectPath("src/a.ts")), "text");
        assert.equal(host.directoryExists!(projectPath("src")), true);
        assert.equal(host.realpath!(projectPath("src/a.ts")), projectPath("src/a.ts"));
        assert.deepEqual(host.getDirectories!(projectRoot), ["src"]);
        assert.equal(host.getCurrentDirectory!(), process.cwd());
        assert.equal(host.useCaseSensitiveFileNames, true);
        assert.deepEqual(known.misses, []);
        assert.equal(host.fileExists(projectPath("src/b.ts")), false);
        assert.deepEqual(known.misses, [
            {
                kind: "file",
                path: projectPath("src/b.ts"),
            },
        ]);
    });

    test("a module resolves through the file system once what it asked for is read", async () => {
        const reading = createReading(createFakeFileSystem({
            [projectPath("src/a.ts")]: "export const a = 1;",
        }));
        const resolved = await untilKnown(reading, () => ts.resolveModuleName("./a.ts", projectPath("src/main.ts"), {
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            allowImportingTsExtensions: true,
        }, moduleResolutionHost(reading.known)));
        assert.equal(resolved.resolvedModule?.resolvedFileName, projectPath("src/a.ts"));
        assert.equal(reading.known.files.get(projectPath("src/a.ts")), true);
    });

    test("a path that is not absolute is a programmer error", () => {
        const host = moduleResolutionHost(createKnownFiles());
        assert.throws(() => host.fileExists("a.ts"));
        assert.throws(() => host.readFile("a.ts"));
        assert.throws(() => host.directoryExists!("src"));
        assert.throws(() => host.realpath!("a.ts"));
    });
});

describe("parseConfigHost", () => {
    test("a config is read from what is known and lists no files", () => {
        const known = createKnownFiles();
        known.files.set(projectPath("tsconfig.json"), true);
        known.texts.set(projectPath("tsconfig.json"), "{}");
        const host = parseConfigHost(known);
        assert.equal(host.useCaseSensitiveFileNames, true);
        assert.deepEqual(host.readDirectory(projectRoot, [".ts"], undefined, ["**/*"]), []);
        assert.equal(host.fileExists(projectPath("tsconfig.json")), true);
        assert.equal(host.readFile(projectPath("tsconfig.json")), "{}");
        assert.deepEqual(known.misses, []);
    });

    test("a path that is not absolute is a programmer error", () => {
        const host = parseConfigHost(createKnownFiles());
        assert.throws(() => host.fileExists("tsconfig.json"));
        assert.throws(() => host.readFile("tsconfig.json"));
    });
});

describe("knownSource", () => {
    test("a file read is parsed once per language version and kept", () => {
        const known = createKnownFiles();
        known.texts.set(projectPath("a.ts"), "export const a = 1;");
        const source = knownSource(known, projectPath("a.ts"), ts.ScriptTarget.ES2022);
        assert.equal(source?.text, "export const a = 1;");
        assert.equal(knownSource(known, projectPath("a.ts"), ts.ScriptTarget.ES2022), source);
        assert.equal(knownSource(known, projectPath("a.ts"), {
            languageVersion: ts.ScriptTarget.ES2022,
        }), source);
        assert.notEqual(knownSource(known, projectPath("a.ts"), ts.ScriptTarget.ES2020), source);
        assert.equal(known.parsed.size, 2);
    });

    test("a file is parsed again for each module format, so one parsed as CommonJS is not kept for an ES module", () => {
        const known = createKnownFiles();
        known.texts.set(projectPath("a.ts"), "export const a = 1;");
        const asCommonJs = knownSource(known, projectPath("a.ts"), {
            languageVersion: ts.ScriptTarget.ES2022,
            impliedNodeFormat: ts.ModuleKind.CommonJS,
        });
        const asModule = knownSource(known, projectPath("a.ts"), {
            languageVersion: ts.ScriptTarget.ES2022,
            impliedNodeFormat: ts.ModuleKind.ESNext,
        });
        assert.notEqual(asModule, asCommonJs);
        assert.equal(asModule?.impliedNodeFormat, ts.ModuleKind.ESNext);
        assert.equal(asCommonJs?.impliedNodeFormat, ts.ModuleKind.CommonJS);
        assert.equal(knownSource(known, projectPath("a.ts"), {
            languageVersion: ts.ScriptTarget.ES2022,
            impliedNodeFormat: ts.ModuleKind.ESNext,
        }), asModule);
    });

    test("an empty file is a file, and one that cannot be read has no source", () => {
        const known = createKnownFiles();
        known.texts.set(projectPath("empty.ts"), "");
        known.texts.set(projectPath("unreadable.ts"), undefined);
        assert.equal(knownSource(known, projectPath("empty.ts"), ts.ScriptTarget.ES2022)?.text, "");
        assert.equal(knownSource(known, projectPath("unreadable.ts"), ts.ScriptTarget.ES2022), undefined);
        assert.deepEqual(known.misses, []);
    });

    test("a file not read yet has no source, and is asked for", () => {
        const known = createKnownFiles();
        assert.equal(knownSource(known, projectPath("a.ts"), ts.ScriptTarget.ES2022), undefined);
        assert.deepEqual(known.misses, [
            {
                kind: "text",
                path: projectPath("a.ts"),
            },
        ]);
    });

    test("a path that is not absolute is a programmer error", () => {
        assert.throws(() => knownSource(createKnownFiles(), "a.ts", ts.ScriptTarget.ES2022), /not an absolute path/);
    });
});

describe("createCompilerHost", () => {
    test("JSDoc is parsed only where a type error needs it, so a TypeScript file's comments are left as text", async () => {
        const known = createKnownFiles();
        known.texts.set(projectPath("src/a.ts"), "/** The answer. @param value what to add */\nexport function a(value: number): number {\n    return value;\n}\n");
        known.files.set(projectPath("src/a.ts"), true);
        const host = createCompilerHost(known);
        assert.equal(host.jsDocParsingMode, ts.JSDocParsingMode.ParseForTypeErrors);
        const program = ts.createProgram({
            rootNames: [projectPath("src/a.ts")],
            options: {
                noLib: true,
                types: [],
            },
            host,
        });
        const source = program.getSourceFile(projectPath("src/a.ts"));
        assert(source !== undefined);
        const declaration = source.statements[0];
        assert(declaration !== undefined);
        assert.deepEqual(ts.getJSDocTags(declaration), []);
    });

    test("the compiler host answers every read from what is known and refuses to write", () => {
        const known = createKnownFiles();
        known.texts.set(projectPath("src/a.ts"), "export const a = 1;");
        known.texts.set(projectPath("src/missing.ts"), undefined);
        known.files.set(projectPath("src/a.ts"), true);
        known.directories.set(projectPath("src"), true);
        known.realPaths.set(projectPath("src/a.ts"), projectPath("src/a.ts"));
        known.listings.set(projectRoot, [
            {
                name: "src",
                kind: "directory",
            },
        ]);
        const host = createCompilerHost(known);
        const source = host.getSourceFile(projectPath("src/a.ts"), ts.ScriptTarget.ES2022);
        assert.equal(source?.text, "export const a = 1;");
        assert.notEqual(source?.statements[0]?.parent, undefined);
        assert.equal(host.getSourceFile(projectPath("src/missing.ts"), ts.ScriptTarget.ES2022), undefined);
        assert.equal(host.getDefaultLibFileName(optionsDefault), ts.getDefaultLibFilePath(optionsDefault));
        assert.throws(() => host.writeFile(projectPath("out.js"), "", false), /never writes/);
        assert.equal(host.getCurrentDirectory(), process.cwd());
        assert.equal(host.getCanonicalFileName("A.ts"), "A.ts");
        assert.equal(host.useCaseSensitiveFileNames(), true);
        assert.equal(host.getNewLine(), "\n");
        assert.equal(host.readFile(projectPath("src/a.ts")), "export const a = 1;");
        assert.equal(host.fileExists(projectPath("src/a.ts")), true);
        assert.equal(host.realpath!(projectPath("src/a.ts")), projectPath("src/a.ts"));
        assert.deepEqual(host.getDirectories!(projectRoot), ["src"]);
        assert.equal(host.directoryExists!(projectPath("src")), true);
        assert.deepEqual(known.misses, []);
    });

    test("a path that is not absolute is a programmer error", () => {
        const host = createCompilerHost(createKnownFiles());
        assert.throws(() => host.readFile("a.ts"));
        assert.throws(() => host.fileExists("a.ts"));
        assert.throws(() => host.realpath!("a.ts"));
        assert.throws(() => host.directoryExists!("src"));
    });
});

describe("augmentingFiles", () => {
    test("the TypeScript files under a config's directory that declare a global or a module are found, and nothing else", async () => {
        const reading = createReading(createFakeFileSystem({
            "/work/app/tsconfig.json": "{}\n",
            "/work/app/src/app.ts": "declare global {\n    interface Window { user: string }\n}\nexport {};\n",
            "/work/app/src/express.d.ts": "declare module \"express\" {\n    interface Request { callId: string }\n}\n",
            "/work/app/src/plain.ts": "export const plain = 1;\n",
            "/work/app/src/notes.md": "declare global in a document\n",
            "/work/app/node_modules/pkg/index.ts": "declare global {}\n",
            "/work/app/.cache/kept.ts": "declare global {}\n",
            "/work/other/outside.ts": "declare global {}\n",
        }));
        const found = await untilKnown(reading, () => augmentingFiles(reading.known, "/work/app/tsconfig.json"));
        assert.deepEqual([...found].sort(), ["/work/app/src/app.ts", "/work/app/src/express.d.ts"]);
    });

    test("a relative config path is refused", () => {
        assert.throws(() => augmentingFiles(createKnownFiles(), "tsconfig.json"), assert.AssertionError);
    });
});

describe("isAugmenting", () => {
    test("a declare global or a declare module block declares something for every file", () => {
        assert.equal(isAugmenting("declare global {\n}"), true);
        assert.equal(isAugmenting("declare   module 'x' {}"), true);
        assert.equal(isAugmenting("export const declared = 1;"), false);
        assert.equal(isAugmenting("declare const value: number;"), false);
    });
});
