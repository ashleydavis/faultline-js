//
// Turns one reading of V8's coverage into the code paths it exercised, in every file of the project
// that ran, not only the file whose function was called.
//
// Each project file is measured once, the first time a reading names it: its code paths are found
// in the text the module hooks loaded for it. A file imported afresh carries a query on its URL,
// and is counted as the file it is a copy of.
//

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { pathsIn } from "../coverage/paths.ts";
import { exercisedPaths, measureFile, type MeasuredFile, type ScriptCoverage } from "../coverage/v8.ts";
import { isDeclarationFile, isSimFile, isTestFile, sourceExtensions } from "../discover/sources.ts";
import { keepTranspiled, type ILoader } from "../load/hooks.ts";
import { isOwnFile } from "./judge.ts";

//
// Measures project files, each once.
//
export interface IMeasurer {
    //
    // The code paths of the file a URL names, found in the text loaded for it, or undefined when
    // the URL names no source file of the project.
    //
    measure(url: string): Promise<MeasuredFile | undefined>;
}

//
// The key a code path is counted under. A tab cannot be part of a file's name in any project
// Faultline reads, so two different paths never share a key.
//
export function pathKey(file: string, name: string): string {
    assert(!file.includes("\t"));
    assert(name.length > 0);
    return `${file}\t${name}`;
}

//
// The file a code path's key names.
//
export function fileOfPathKey(key: string): string {
    const tab = key.indexOf("\t");
    assert(tab > 0, `${key} is not the key of a code path.`);
    const file = key.slice(0, tab);
    assert(!file.includes("\t"));
    return file;
}

//
// A URL without the query a fresh import adds to it.
//
export function withoutQuery(url: string): string {
    const bare = url.split("?")[0];
    assert(bare !== undefined);
    assert(!bare.includes("?"));
    return bare;
}

//
// Whether a file is one whose code paths count: a source file of the project, not a sim file, a
// test or a file of types.
//
export function isMeasurable(projectRoot: string, file: string): boolean {
    assert(path.isAbsolute(projectRoot));
    assert(path.isAbsolute(file));
    if (!isOwnFile(projectRoot, file)) {
        return false;
    }
    if (!sourceExtensions.includes(path.extname(file))) {
        return false;
    }
    if (isSimFile(file)) {
        return false;
    }
    if (isTestFile(file)) {
        return false;
    }
    return !isDeclarationFile(file);
}

//
// Measures the file a URL names, or gives undefined when it is no source file of the project.
//
export async function measureUrl(loader: ILoader, url: string): Promise<MeasuredFile | undefined> {
    if (!url.startsWith("file:")) {
        return undefined;
    }
    const file = fileURLToPath(url);
    const root = loader.settings.projectRoot;
    if (!isMeasurable(root, file)) {
        return undefined;
    }
    const text = await loader.reading.fileSystem.readText(file);
    //
    // The hooks transpiled the file on their own thread, so this thread transpiles it once more
    // itself, which gives the same text, and keeps it for every later reading.
    //
    const loaded = loader.transpiled.get(file) ?? await keepTranspiled(loader, file, text);
    assert.equal(loader.transpiled.get(file), loaded);
    const relative = path.relative(root, file).split(path.sep).join("/");
    assert(!relative.startsWith(".."));
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    return measureFile(url, loaded, pathsIn(source, relative));
}

//
// A measurer that keeps what it measured for as long as it lives.
//
export function createMeasurer(loader: ILoader): IMeasurer {
    assert(path.isAbsolute(loader.settings.projectRoot));
    const measured = new Map<string, MeasuredFile | undefined>();
    return {
        async measure(url: string): Promise<MeasuredFile | undefined> {
            assert(url.length > 0);
            if (measured.has(url)) {
                return measured.get(url);
            }
            const found = await measureUrl(loader, url);
            measured.set(url, found);
            assert(measured.has(url));
            return found;
        },
    };
}

//
// The keys of every code path one reading exercised, sorted, each once.
//
export async function exercisedKeys(reading: ScriptCoverage[], measurer: IMeasurer): Promise<string[]> {
    const keys = new Set<string>();
    for (const script of reading) {
        //
        // Code made at run time, with `new Function` or `eval`, has no URL. It is in no file of the
        // project, so it has no code path to tick. Schema libraries make code this way on every
        // call, so it is in most readings.
        //
        if (!script.url) {
            continue;
        }
        const url = withoutQuery(script.url);
        const measured = await measurer.measure(url);
        if (measured === undefined) {
            continue;
        }
        const paths = exercisedPaths([{
            ...script,
            url,
        }], measured);
        for (const exercised of paths) {
            keys.add(pathKey(exercised.file, exercised.name));
        }
    }
    const sorted = [...keys].sort();
    assert.equal(sorted.length, keys.size);
    assert(sorted.every((key) => key.includes("\t")));
    return sorted;
}
