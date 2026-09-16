// What the tests build a project out of.
//
// Only the tests call this. It is here rather than in a test file because more than one test file
// needs it, and a test file is never imported by anything.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { buildProgram, type BuiltProgram } from "./build/program.ts";
import type { RecipeContext } from "./discover/recipes.ts";

// A project written to disk, with the program over it.
export interface Fixture {
    // The directory the files were written into.
    root: string;

    // The program over them.
    built: BuiltProgram;

    // What a recipe is read through.
    context: RecipeContext;

    // One file's parsed source, by the name it was written under.
    source: (file: string) => ts.SourceFile;

    // Throws the directory away.
    remove: () => void;
}

// Writes `files` into a directory of its own and builds the program over them.
export function fixture(files: Record<string, string>): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "faultline-test-"));
    fs.writeFileSync(path.join(root, "package.json"), '{ "name": "fixture", "type": "module" }\n');
    for (const [name, text] of Object.entries(files)) {
        const full = path.join(root, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, text);
    }
    const full = Object.keys(files).map((name) => path.join(root, name));
    const built = buildProgram(root, full);
    return {
        root,
        built,
        context: {
            checker: built.checker,
            runtimeFile: [path.resolve(here(), "runtime/index.ts")],
            root,
        },
        source: (file: string) => {
            const found = built.program.getSourceFile(path.join(root, file));
            if (found === undefined) {
                throw new Error(`The fixture has no file called ${file}.`);
            }
            return found;
        },
        remove: () => {
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

// Parses one piece of text on its own, for a test that needs no types.
export function parse(text: string, file = "example.ts"): ts.SourceFile {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

// The directory this file is in.
function here(): string {
    return path.dirname(new URL(import.meta.url).pathname);
}
