//
// What the tests build a project out of.
//
// Only the tests call this. It is a file of its own because more than one test file needs it, and
// its name ends in `.test.ts` so the package leaves it out with every other test file. The project
// sits in a file system in memory and its program is compiled with the small library of built-in
// types `src/lib/fake-files.test.ts` holds, so no test reads the disk or TypeScript's own library.
//

import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { createFakeProject, projectRoot, simTypesFile, type IFakeFileSystem } from "../lib/fake-files.test.ts";
import { createReading } from "../lib/known-files.ts";
import { buildProgram, type IBuiltProgram } from "./program.ts";
import type { RecipeContext } from "./recipes.ts";

//
// A project in memory, with the program over it.
//
export interface IFixture {
    //
    // The directory the files sit in.
    //
    root: string;

    //
    // The file system in memory the files sit in.
    //
    fileSystem: IFakeFileSystem;

    //
    // The program over them.
    //
    built: IBuiltProgram;

    //
    // What a recipe is read through.
    //
    context: RecipeContext;

    //
    // One file's parsed source, by the name it was written under.
    //
    source(file: string): ts.SourceFile;
}

//
// Puts `files` in a project in memory and builds the program over them. A file named
// `tsconfig.json` replaces the project's own.
//
export async function fixture(files: Record<string, string>): Promise<IFixture> {
    const fileSystem = createFakeProject(files);
    const full = Object.keys(files).filter((name) => name !== "tsconfig.json").map((name) => path.join(projectRoot, name));
    const built = await buildProgram(createReading(fileSystem), path.join(projectRoot, "tsconfig.json"), full);
    return {
        root: projectRoot,
        fileSystem,
        built,
        context: {
            checker: built.checker,
            simTypesFile: [simTypesFile],
            root: projectRoot,
        },
        source: (file: string) => fixtureSource(built, file),
    };
}

//
// The parsed source of one file of a fixture, by the name it was written under, so a test that
// names a file the fixture does not hold fails at once with the name.
//
export function fixtureSource(built: IBuiltProgram, file: string): ts.SourceFile {
    const found = built.program.getSourceFile(path.join(projectRoot, file));
    assert.ok(found, `The fixture has no file called ${file}.`);
    return found;
}

//
// Parses one piece of text on its own, for a test that needs no types. No test reads the file name
// back, so any name a TypeScript file can have will do.
//
export function parse(text: string): ts.SourceFile {
    return ts.createSourceFile("example.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
