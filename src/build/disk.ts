// How the compiler reads the project.
//
// Every other part of the tool reads a project through `node:fs`: the walk that finds its sources,
// the read that decides whether it is written as modules, the write that puts a copy in the work
// directory. The compiler read it through TypeScript's own `ts.sys`, which goes straight to the
// disk, so a run pointed at a tree `node:fs` could see and the disk could not read no file at all.
// Both read through `node:fs` now, so one thing decides what a file holds.

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Reads one file, or hands back nothing where there is none. The compiler asks for files that are
// often not there, so a missing one is an answer rather than a failure.
function readFile(where: string): string | undefined {
    try {
        return fs.readFileSync(where, "utf8");
    }
    catch {
        return undefined;
    }
}

// Whether one path is a file.
function fileExists(where: string): boolean {
    try {
        return fs.statSync(where).isFile();
    }
    catch {
        return false;
    }
}

// Whether one path is a directory.
function directoryExists(where: string): boolean {
    try {
        return fs.statSync(where).isDirectory();
    }
    catch {
        return false;
    }
}

// What one directory holds, as directories.
function getDirectories(where: string): string[] {
    try {
        return fs.readdirSync(where).filter((name) => directoryExists(path.join(where, name)));
    }
    catch {
        return [];
    }
}

// What the compiler resolves a module specifier through. A specifier names a file, and this is what
// decides whether that file is there.
export const resolutionHost: ts.ModuleResolutionHost = {
    fileExists,
    readFile,
    directoryExists,
    getDirectories,
    realpath: (where) => where,
};

// What the compiler reads a `tsconfig.json` through. The one member left as TypeScript's own is
// the directory walk a config's `include` patterns are matched over, which has no equivalent here
// and decides only which files a config lists. A run names the files it measures itself.
export const configSystem: ts.System = {
    ...ts.sys,
    fileExists,
    readFile,
    directoryExists,
    getDirectories,
};

// What a program reads its source through.
export function projectHost(options: ts.CompilerOptions): ts.CompilerHost {
    const host = ts.createCompilerHost(options, true);
    host.fileExists = fileExists;
    host.readFile = readFile;
    host.directoryExists = directoryExists;
    host.getDirectories = getDirectories;
    host.getSourceFile = (where, languageVersion) => {
        const text = readFile(where);
        if (text === undefined) {
            return undefined;
        }
        return ts.createSourceFile(where, text, languageVersion, true);
    };
    return host;
}
