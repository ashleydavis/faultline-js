//
// Tests the module hooks that load a project into the child process. The goal is that every import
// a project makes leads where its own build sends it and loads as the code its build runs.
//
// The method is to call the resolve and load hooks directly on a small project held in a file
// system in memory, with stand-ins for the hooks Node would call next that record what they were
// handed, so no test reads the disk or starts a process. The tool's own directory, with the
// simulated module the tests import, is in the same file system. That a real Node process imports a
// project through the hooks is checked by the smoke script.
//

import assert from "node:assert/strict";
import type module from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "@jest/globals";
import ts from "typescript";
import { createFakeFileSystem } from "../lib/fake-files.test.ts";
import type { IFakeFileSystem } from "../lib/fake-files.test.ts";
import {
    compilerOptions,
    codeOfError,
    copyNumberOf,
    createLoader,
    fileOf,
    findByNode,
    hasType,
    isInside,
    isProjectFile,
    keepTranspiled,
    keptResolution,
    loadedText,
    loadModule,
    moduleFormat,
    nearestPackageFile,
    numberedUrl,
    packageType,
    resolveAsBundler,
    resolveInProject,
    resolveModule,
    simulatedModule,
    transpile,
    withJsonType,
} from "./hooks.ts";
import type { ILoader, NextLoad, NextResolve } from "./hooks.ts";

//
// The directory the tool's own modules sit in, which is where the simulated built-in modules are.
//
const toolModules = "/faultline/src";

//
// The project the hooks load. Its `tsconfig.json` is in `app/`, so `loose.ts` at the root has none.
//
const root = "/work/project";

//
// The project's files, by their path under the root.
//
const projectFiles: Record<string, string> = {
    "package.json": "{ \"name\": \"project\", \"type\": \"module\" }\n",
    "app/tsconfig.json": "{ \"compilerOptions\": { \"module\": \"ESNext\", \"moduleResolution\": \"bundler\", \"baseUrl\": \".\", \"paths\": { \"@lib/*\": [\"src/lib/*\"] } } }\n",
    "app/src/main.ts": [
        "import fs from \"node:fs\";",
        "import { helper } from \"./helper\";",
        "import { thing } from \"@lib/thing\";",
        "import { other } from \"./other.js\";",
        "import styles from \"./look.css\";",
        "import { packageFs } from \"some-package\";",
        "",
        "function hidden(value: number): number {",
        "    return value + 1;",
        "}",
        "",
        "export const projectFs = fs;",
        "export const parts = [helper(), thing, other, styles, packageFs];",
        "",
    ].join("\n"),
    "app/src/helper.ts": "export function helper(): string { return \"helper\"; }\n",
    "app/src/lib/thing.ts": "export const thing: string = \"thing\";\n",
    "app/src/other.ts": "export const other: string = \"other\";\n",
    "app/src/look.css": ".look { color: red; }\n",
    "app/src/typed.js": "export const typed = 1;\n",
    "app/src/typed.d.ts": "export declare const typed: number;\n",
    "app/src/data.json": "{}\n",
    "app/src/view.tsx": "export function View(): unknown { return <div />; }\n",
    "app/node_modules/some-package/package.json": "{ \"name\": \"some-package\", \"type\": \"module\", \"main\": \"index.js\" }\n",
    "app/node_modules/some-package/index.js": "import fs from \"fs\";\nexport const packageFs = fs;\n",
    "old/package.json": "{ \"name\": \"old\", \"type\": \"commonjs\" }\n",
    "old/plain.ts": "import { join } from \"node:path\";\nfunction hidden(): string { return join(\"a\", \"b\"); }\n",
    "old/modern.mts": "function hidden(): void {}\n",
    "untyped/package.json": "{ \"name\": \"untyped\" }\n",
    "untyped/plain.ts": "function hidden(): void {}\n",
    "untyped/legacy.cts": "function hidden(): void {}\n",
    "loose.ts": "const kept = 1;\n",
    "node/tsconfig.json": "{ \"compilerOptions\": { \"module\": \"NodeNext\", \"moduleResolution\": \"NodeNext\" } }\n",
    "node/main.ts": "export const kept = 1;\n",
};

//
// A file system in memory holding the project above, with no `package.json` anywhere above it, and
// the simulated `node:fs` in the tool's directory, which is where the hooks look for it.
//
export function projectFileSystem(): IFakeFileSystem {
    const files: Record<string, string> = {
        [path.join(toolModules, "world", "effects", "fs.ts")]: "export {};\n",
    };
    for (const [name, text] of Object.entries(projectFiles)) {
        files[path.join(root, name)] = text;
    }
    return createFakeFileSystem(files);
}

//
// A loader for the project above, over `files`.
//
export function loaderOver(files: IFakeFileSystem): ILoader {
    return createLoader({
        projectRoot: root,
        toolModules,
    }, files);
}

//
// A loader for the project above, over a file system of its own.
//
export function projectLoader(): ILoader {
    return loaderOver(projectFileSystem());
}

//
// The `file:` URL of a file of the project.
//
export function urlOf(name: string): string {
    return pathToFileURL(path.join(root, name)).href;
}

//
// The URL of the copy of a project file that belongs to the call numbered `copyNumber`.
//
export function copyOf(name: string, copyNumber: number): string {
    return `${urlOf(name)}?flt=${copyNumber}`;
}

//
// The context Node gives the resolve hook for an import written in `importer`, or in no file when
// `importer` is undefined.
//
export function importedFrom(importer: string | undefined): module.ResolveHookContext {
    return {
        conditions: ["node", "import"],
        importAttributes: {},
        parentURL: importer,
    };
}

//
// The context Node gives the load hook.
//
const loadContext: module.LoadHookContext = {
    conditions: ["node", "import"],
    format: undefined,
    importAttributes: {},
};

//
// A stand-in for Node's own resolve hook that records each specifier in `handedOn` and answers with
// a URL that says it was Node's answer.
//
export function recordingResolve(handedOn: string[]): NextResolve {
    return (specifier: string) => {
        handedOn.push(specifier);
        return {
            url: `next:${specifier}`,
        };
    };
}

//
// A stand-in for Node's own load hook that records each URL in `handedOn` and answers with no
// source.
//
export function recordingLoad(handedOn: string[]): NextLoad {
    return (url: string) => {
        handedOn.push(url);
        return {
            format: "next",
        };
    };
}

//
// The URL the resolve hook answers for `specifier` imported from `importer`, or imported from no
// file when `importer` is undefined.
//
export async function resolved(specifier: string, importer: string | undefined): Promise<string> {
    const answer = await resolveModule(projectLoader(), specifier, importedFrom(importer), recordingResolve([]));
    return answer.url;
}

describe("resolveModule", () => {
    const main = urlOf("app/src/main.ts");

    test("an extensionless import leads to the TypeScript file", async () => {
        assert.equal(await resolved("./helper", main), urlOf("app/src/helper.ts"));
    });

    test("an import through paths leads where the tsconfig.json sends it", async () => {
        assert.equal(await resolved("@lib/thing", main), urlOf("app/src/lib/thing.ts"));
    });

    test("an import naming a .js file leads to the .ts file", async () => {
        assert.equal(await resolved("./other.js", main), urlOf("app/src/other.ts"));
    });

    test("an import in a copy leads to the copy of the same call", async () => {
        assert.equal(await resolved("./helper", copyOf("app/src/main.ts", 7)), copyOf("app/src/helper.ts", 7));
        assert.equal(await resolved("./helper", copyOf("app/src/main.ts", 0)), copyOf("app/src/helper.ts", 0));
    });

    test("an answer from TypeScript is final", async () => {
        const answer = await resolveModule(projectLoader(), "./helper", importedFrom(main), recordingResolve([]));
        assert.equal(answer.shortCircuit, true);
    });

    test("a simulated built-in module is the simulated one for the project, a package and the entry point", async () => {
        const simulated = pathToFileURL(path.join(toolModules, "world", "effects", "fs.ts")).href;
        assert.equal(await resolved("node:fs", main), simulated);
        assert.equal(await resolved("node:fs", copyOf("app/src/main.ts", 3)), simulated);
        assert.equal(await resolved("fs", main), simulated);
        assert.equal(await resolved("fs", urlOf("app/node_modules/some-package/index.js")), simulated);
        assert.equal(await resolved("node:fs", undefined), simulated);
    });

    test("the tool's own modules get the real built-in modules", async () => {
        const effect = pathToFileURL(path.join(toolModules, "world", "effects", "fs.ts")).href;
        const handedOn: string[] = [];
        const loader = projectLoader();
        const real = await resolveModule(loader, "node:fs", importedFrom(effect), recordingResolve(handedOn));
        const relative = await resolveModule(loader, "./helper", importedFrom(effect), recordingResolve(handedOn));
        assert.equal(real.url, "next:node:fs");
        assert.equal(relative.url, "next:./helper");
        assert.deepEqual(handedOn, ["node:fs", "./helper"]);
    });

    test("a package, a file with only types, a missing file and a package's own import are Node's to find", async () => {
        assert.equal(await resolved("some-package", main), "next:some-package");
        assert.equal(await resolved("./typed", main), "next:./typed");
        assert.equal(await resolved("./missing", main), "next:./missing");
        assert.equal(await resolved("./index.js", urlOf("app/node_modules/some-package/index.js")), "next:./index.js");
        assert.equal(await resolved("node:path", main), "next:node:path");
        assert.equal(await resolved("./helper", undefined), "next:./helper");
    });

    test("a JSON file a project file imports gets the json type, whoever resolves it", async () => {
        const loader = projectLoader();
        const fromNode = await resolveModule(loader, "./data.json", importedFrom(main), recordingResolve([]));
        const fromPackage = await resolveModule(loader, "./data.json", importedFrom(urlOf("app/node_modules/some-package/index.js")), recordingResolve([]));
        assert.equal(fromNode.importAttributes?.type, "json");
        assert.equal(fromPackage.importAttributes, undefined);
    });

    test("a package's file a project file names without its extension is found", async () => {
        const answer = await resolveModule(projectLoader(), "dayjs/plugin/timezone", importedFrom(main), findingResolve([], ["dayjs/plugin/timezone.js"]));
        assert.equal(answer.url, "next:dayjs/plugin/timezone.js");
    });

    test("an empty specifier is refused", async () => {
        await assert.rejects(resolveModule(projectLoader(), "", importedFrom(main), recordingResolve([])), assert.AssertionError);
    });
});

//
// The error Node's resolve hook throws for a module it cannot find.
//
export class ModuleNotFound extends Error {
    //
    // The code Node gives the error, which is what the hooks read.
    //
    code = "ERR_MODULE_NOT_FOUND";
}

//
// A stand-in for Node's own resolve hook that records each specifier in `handedOn` and finds only
// the specifiers in `found`, failing every other one as Node fails a module it cannot find.
//
export function findingResolve(handedOn: string[], found: string[]): NextResolve {
    return (specifier: string) => {
        handedOn.push(specifier);
        if (!found.includes(specifier)) {
            throw new ModuleNotFound(`Cannot find module ${specifier}.`);
        }
        return {
            url: `next:${specifier}`,
        };
    };
}

describe("resolveAsBundler", () => {
    const importer = path.join(root, "app/src/main.ts");

    test("a package's file named without its extension is found with the extension a bundler tries", async () => {
        const handedOn: string[] = [];
        const answer = await resolveAsBundler(projectLoader(), "dayjs/plugin/timezone", importer, importedFrom(urlOf("app/src/main.ts")), findingResolve(handedOn, ["dayjs/plugin/timezone.js"]));
        assert.equal(answer.url, "next:dayjs/plugin/timezone.js");
        assert.deepEqual(handedOn, ["dayjs/plugin/timezone", "dayjs/plugin/timezone.js"]);
    });

    test("an import Node finds as written is Node's answer, asked once", async () => {
        const handedOn: string[] = [];
        const answer = await resolveAsBundler(projectLoader(), "some-package", importer, importedFrom(urlOf("app/src/main.ts")), findingResolve(handedOn, ["some-package"]));
        assert.equal(answer.url, "next:some-package");
        assert.deepEqual(handedOn, ["some-package"]);
    });

    test("an index file is tried last", async () => {
        const handedOn: string[] = [];
        const answer = await resolveAsBundler(projectLoader(), "pkg/dir", importer, importedFrom(urlOf("app/src/main.ts")), findingResolve(handedOn, ["pkg/dir/index.js"]));
        assert.equal(answer.url, "next:pkg/dir/index.js");
        assert.deepEqual(handedOn, ["pkg/dir", "pkg/dir.js", "pkg/dir.mjs", "pkg/dir.cjs", "pkg/dir/index.js"]);
    });

    test("an import no extension finds fails with Node's own error for the import as written", async () => {
        const handedOn: string[] = [];
        await assert.rejects(resolveAsBundler(projectLoader(), "pkg/missing", importer, importedFrom(urlOf("app/src/main.ts")), findingResolve(handedOn, [])), /Cannot find module pkg\/missing\./);
        assert.equal(handedOn.at(-1), "pkg/missing");
        assert.equal(handedOn.length, 6);
    });

    test("a file whose options do not say bundler resolution gets Node's answer with no extension tried", async () => {
        const handedOn: string[] = [];
        await assert.rejects(resolveAsBundler(projectLoader(), "pkg/file", path.join(root, "node/main.ts"), importedFrom(urlOf("node/main.ts")), findingResolve(handedOn, [])), ModuleNotFound);
        assert.deepEqual(handedOn, ["pkg/file"]);
    });

    test("a file outside the project is refused", async () => {
        await assert.rejects(resolveAsBundler(projectLoader(), "pkg/file", "/elsewhere/main.ts", importedFrom(undefined), recordingResolve([])), assert.AssertionError);
    });
});

describe("findByNode", () => {
    test("a module Node finds is its answer and one it cannot find is none", async () => {
        const found = await findByNode("here", importedFrom(undefined), findingResolve([], ["here"]));
        const missing = await findByNode("gone", importedFrom(undefined), findingResolve([], ["here"]));
        assert.equal(found?.url, "next:here");
        assert.equal(missing, undefined);
    });

    test("any other error is Node's to raise", async () => {
        const failing: NextResolve = () => {
            throw new TypeError("Invalid module specifier.");
        };
        await assert.rejects(findByNode("bad", importedFrom(undefined), failing), TypeError);
    });

    test("an empty specifier is refused", async () => {
        await assert.rejects(findByNode("", importedFrom(undefined), recordingResolve([])), assert.AssertionError);
    });
});

describe("codeOfError", () => {
    test("an error's code is read", () => {
        assert.equal(codeOfError(new ModuleNotFound("missing")), "ERR_MODULE_NOT_FOUND");
    });

    test("a value with no code gives none", () => {
        assert.equal(codeOfError(new Error("plain")), undefined);
        assert.equal(codeOfError(null), undefined);
        assert.equal(codeOfError("text"), undefined);
    });
});

describe("withJsonType", () => {
    test("an answer leading to a JSON file is given the json type", () => {
        const answer = withJsonType({
            url: `${urlOf("app/src/data.json")}?flt=3`,
        }, importedFrom(urlOf("app/src/main.ts")));
        assert.deepEqual(answer.importAttributes, {
            type: "json",
        });
        assert.equal(answer.url, `${urlOf("app/src/data.json")}?flt=3`);
    });

    test("an import that already names its type keeps it", () => {
        const context = {
            ...importedFrom(urlOf("app/src/main.ts")),
            importAttributes: {
                type: "json",
            },
        };
        const answer = withJsonType({
            url: urlOf("app/src/data.json"),
        }, context);
        assert.equal(answer.importAttributes, undefined);
    });

    test("an answer leading to any other file is left alone", () => {
        const answer = withJsonType({
            url: urlOf("app/src/helper.ts"),
        }, importedFrom(urlOf("app/src/main.ts")));
        assert.equal(answer.importAttributes, undefined);
        assert.equal(answer.url, urlOf("app/src/helper.ts"));
    });
});

describe("resolveInProject", () => {
    test("only a project file TypeScript can run is an answer, with no number on it", async () => {
        const importer = path.join(root, "app/src/main.ts");
        const loader = projectLoader();
        assert.equal(await resolveInProject(loader, "./helper", importer), path.join(root, "app/src/helper.ts"));
        assert.equal(await resolveInProject(loader, "some-package", importer), undefined);
        assert.equal(await resolveInProject(loader, "./typed", importer), undefined);
        assert.equal(await resolveInProject(loader, "./missing", importer), undefined);
    });

    test("a relative importer is refused", async () => {
        await assert.rejects(resolveInProject(projectLoader(), "./helper", "app/src/main.ts"), assert.AssertionError);
    });
});

describe("keptResolution", () => {
    test("an import is resolved once per importer and specifier, so a later copy is answered without the files", async () => {
        const files = projectFileSystem();
        const loader = loaderOver(files);
        const importer = path.join(root, "app/src/main.ts");
        const helper = path.join(root, "app/src/helper.ts");
        assert.equal(await keptResolution(loader, "./helper", importer), helper);
        assert.equal(await keptResolution(loader, "./missing", importer), undefined);
        files.files.delete(helper);
        assert.equal(await keptResolution(loader, "./helper", importer), helper);
        assert.equal(await keptResolution(loader, "./missing", importer), undefined);
        assert.equal(loader.resolutions.size, 2);
    });

    test("the same specifier from another importer is resolved on its own", async () => {
        const loader = projectLoader();
        assert.equal(await keptResolution(loader, "./helper", path.join(root, "app/src/main.ts")), path.join(root, "app/src/helper.ts"));
        assert.equal(await keptResolution(loader, "./helper", path.join(root, "app/src/elsewhere/main.ts")), undefined);
        assert.equal(loader.resolutions.size, 2);
    });
});

describe("simulatedModule", () => {
    test("a built-in module's simulated file is found once, and a specifier with none is kept as none", async () => {
        const files = projectFileSystem();
        const loader = loaderOver(files);
        const simulated = path.join(toolModules, "world", "effects", "fs.ts");
        assert.equal(await simulatedModule(loader, "node:fs"), simulated);
        assert.equal(await simulatedModule(loader, "./helper"), undefined);
        files.files.delete(simulated);
        assert.equal(await simulatedModule(loader, "node:fs"), simulated);
        assert.equal(loader.simulatedModules.size, 2);
    });
});

describe("loadModule", () => {
    test("a project TypeScript file is transpiled with everything exported and a source map", async () => {
        const loaded = await loadModule(projectLoader(), urlOf("app/src/main.ts"), loadContext, recordingLoad([]));
        assert.equal(loaded.format, "module");
        assert.equal(loaded.shortCircuit, true);
        assert.equal(typeof loaded.source, "string");
        assert.match(String(loaded.source), /export function hidden\(value\)/);
        assert.match(String(loaded.source), /sourceMappingURL=data:application\/json;base64,/);
    });

    test("an asset is an empty CommonJS module", async () => {
        for (const name of ["app/src/look.css", "app/src/LOGO.PNG", "app/node_modules/some-package/font.woff2"]) {
            const loaded = await loadModule(projectLoader(), urlOf(name), loadContext, recordingLoad([]));
            assert.deepEqual(loaded, {
                format: "commonjs",
                source: "",
                shortCircuit: true,
            });
        }
    });

    test("a package's file, a JSON file and a built-in module are Node's to load", async () => {
        const handedOn: string[] = [];
        const urls = [urlOf("app/node_modules/some-package/index.js"), urlOf("app/src/data.json"), "node:fs"];
        for (const url of urls) {
            const loaded = await loadModule(projectLoader(), url, loadContext, recordingLoad(handedOn));
            assert.equal(loaded.format, "next");
        }
        assert.deepEqual(handedOn, urls);
    });

    test("a copy of a project file loads the same text as the file", async () => {
        const loader = projectLoader();
        const first = await loadModule(loader, urlOf("app/src/helper.ts"), loadContext, recordingLoad([]));
        const copy = await loadModule(loader, copyOf("app/src/helper.ts", 4), loadContext, recordingLoad([]));
        assert.equal(copy.source, first.source);
        assert.equal(loader.transpiled.size, 1);
    });

    test("a file in a CommonJS package becomes CommonJS", async () => {
        const loaded = await loadModule(projectLoader(), urlOf("old/plain.ts"), loadContext, recordingLoad([]));
        assert.equal(loaded.format, "commonjs");
        assert.match(String(loaded.source), /exports\.hidden = hidden/);
        assert.match(String(loaded.source), /require\("node:path"\)/);
    });

    test("an empty URL is refused", async () => {
        await assert.rejects(loadModule(projectLoader(), "", loadContext, recordingLoad([])), assert.AssertionError);
    });
});

describe("loadedText", () => {
    test("a project file is transpiled once and kept, so a change after the first load is not seen", async () => {
        const files = projectFileSystem();
        const loader = loaderOver(files);
        const file = path.join(root, "app/src/helper.ts");
        const first = await loadedText(loader, file);
        assert.match(first, /function helper\(\)/);
        assert.match(first, /sourceMappingURL=data:/);
        files.files.set(file, "export const changed = 1;\n");
        assert.equal(await loadedText(loader, file), first);
        assert.equal(loader.transpiled.size, 1);
    });

    test("a project file that cannot be read fails with the reading's own error", async () => {
        const loader = projectLoader();
        await assert.rejects(loadedText(loader, path.join(root, "app/src/gone.ts")), {
            code: "ENOENT",
        });
        assert.equal(loader.transpiled.size, 0);
    });

    test("a file outside the project is refused", async () => {
        const loader = projectLoader();
        await assert.rejects(loadedText(loader, path.join(root, "app/node_modules/some-package/index.js")), /is not a project file/);
        assert.equal(loader.transpiled.size, 0);
    });
});

describe("keepTranspiled", () => {
    test("text already read is transpiled and kept for the file it came from", async () => {
        const loader = projectLoader();
        const file = path.join(root, "app/src/helper.ts");
        const kept = await keepTranspiled(loader, file, "function given(): number { return 1; }\n");
        assert.match(kept, /export function given\(\)/);
        assert.equal(loader.transpiled.get(file), kept);
        assert.equal(await loadedText(loader, file), kept);
    });

    test("a relative path is refused", async () => {
        const loader = projectLoader();
        await assert.rejects(keepTranspiled(loader, "helper.ts", "const kept = 1;\n"), assert.AssertionError);
        assert.equal(loader.transpiled.size, 0);
    });
});

describe("transpile", () => {
    test("JSX becomes calls when the project leaves JSX to another tool", async () => {
        const loader = projectLoader();
        const file = path.join(root, "app/src/view.tsx");
        const output = transpile(file, await loader.reading.fileSystem.readText(file), await compilerOptions(loader, file), "module");
        assert.match(output, /react\/jsx-runtime/);
        assert.doesNotMatch(output, /<div/);
    });

    test("the project's own JSX setting is kept", () => {
        const output = transpile("view.tsx", "export const view = <div />;\n", {
            jsx: ts.JsxEmit.Preserve,
        }, "module");
        assert.match(output, /<div \/>/);
    });

    test("verbatimModuleSyntax stays for ES modules and is dropped for CommonJS", () => {
        const text = "import { used } from \"./used.ts\";\nimport { unused } from \"./unused.ts\";\nexport const value = used;\n";
        const options: ts.CompilerOptions = {
            verbatimModuleSyntax: true,
        };
        assert.match(transpile("file.ts", text, options, "module"), /unused/);
        const common = transpile("file.ts", text, options, "commonjs");
        assert.match(common, /require\("\.\/used\.ts"\)/);
        assert.doesNotMatch(common, /unused/);
    });

    test("a file with no name is refused", () => {
        assert.throws(() => transpile("", "const kept = 1;\n", {}, "module"), assert.AssertionError);
    });
});

describe("moduleFormat", () => {
    test("the extension decides when it says, and the package.json otherwise", async () => {
        const loader = projectLoader();
        assert.equal(await moduleFormat(loader, path.join(root, "app/src/main.ts")), "module");
        assert.equal(await moduleFormat(loader, path.join(root, "old/plain.ts")), "commonjs");
        assert.equal(await moduleFormat(loader, path.join(root, "old/modern.mts")), "module");
        assert.equal(await moduleFormat(loader, path.join(root, "untyped/plain.ts")), "module");
        assert.equal(await moduleFormat(loader, path.join(root, "untyped/legacy.cts")), "commonjs");
        assert.equal(await moduleFormat(loader, path.join(root, "untyped/legacy.cjs")), "commonjs");
        assert.equal(await moduleFormat(loader, path.join(root, "untyped/modern.mjs")), "module");
    });

    test("a file with no package.json above it is an ES module", async () => {
        const loader = createLoader({
            projectRoot: root,
            toolModules,
        }, createFakeFileSystem({
            [path.join(root, "plain.ts")]: "const kept = 1;\n",
        }));
        assert.equal(await moduleFormat(loader, path.join(root, "plain.ts")), "module");
        assert.equal(loader.packageTypes.size, 0);
    });

    test("a relative path or a file with no extension is refused", async () => {
        const loader = projectLoader();
        await assert.rejects(moduleFormat(loader, "plain.ts"), assert.AssertionError);
        await assert.rejects(moduleFormat(loader, path.join(root, "Makefile")), /has no extension/);
    });
});

describe("nearestPackageFile", () => {
    test("the package.json in the file's directory or the nearest one above it is found", async () => {
        const files = projectFileSystem();
        assert.equal(await nearestPackageFile(files, path.join(root, "old/plain.ts")), path.join(root, "old/package.json"));
        assert.equal(await nearestPackageFile(files, path.join(root, "app/src/lib/thing.ts")), path.join(root, "package.json"));
    });

    test("a package.json at the root of the disk is found", async () => {
        const files = createFakeFileSystem({
            "/package.json": "{}\n",
        });
        assert.equal(await nearestPackageFile(files, path.join(root, "plain.ts")), "/package.json");
    });

    test("no package.json up to the root of the disk finds none, and a relative path is refused", async () => {
        const files = createFakeFileSystem({});
        assert.equal(await nearestPackageFile(files, path.join(root, "plain.ts")), undefined);
        await assert.rejects(nearestPackageFile(files, "plain.ts"), assert.AssertionError);
    });
});

describe("copyNumberOf", () => {
    test("a copy's URL gives its number", () => {
        assert.equal(copyNumberOf(copyOf("app/src/main.ts", 0)), 0);
        assert.equal(copyNumberOf(copyOf("app/src/main.ts", 12)), 12);
    });

    test("a URL that is no copy gives no number", () => {
        assert.equal(copyNumberOf(urlOf("app/src/main.ts")), undefined);
        assert.equal(copyNumberOf("node:fs"), undefined);
        assert.equal(copyNumberOf(undefined), undefined);
        assert.equal(copyNumberOf(""), undefined);
    });

    test("a copy whose number is missing, not whole or negative is refused", () => {
        assert.throws(() => copyNumberOf(`${urlOf("app/src/main.ts")}?flt=`), /without its number/);
        assert.throws(() => copyNumberOf(`${urlOf("app/src/main.ts")}?flt=1.5`), /not a whole number/);
        assert.throws(() => copyNumberOf(`${urlOf("app/src/main.ts")}?flt=many`), /not a whole number/);
        assert.throws(() => copyNumberOf(`${urlOf("app/src/main.ts")}?flt=-1`), assert.AssertionError);
    });
});

describe("numberedUrl", () => {
    test("a file's URL carries the number in its query", () => {
        assert.equal(numberedUrl(path.join(root, "a.ts"), 0), `${pathToFileURL(path.join(root, "a.ts")).href}?flt=0`);
        assert.equal(numberedUrl(path.join(root, "a.ts"), 12), `${pathToFileURL(path.join(root, "a.ts")).href}?flt=12`);
        assert.equal(fileOf(numberedUrl(path.join(root, "a.ts"), 12)), path.join(root, "a.ts"));
        assert.equal(copyNumberOf(numberedUrl(path.join(root, "a.ts"), 12)), 12);
    });

    test("no number gives the file's own URL", () => {
        assert.equal(numberedUrl(path.join(root, "a.ts"), undefined), pathToFileURL(path.join(root, "a.ts")).href);
    });

    test("a relative path or a number that is no call's is refused", () => {
        assert.throws(() => numberedUrl("a.ts", 1), assert.AssertionError);
        assert.throws(() => numberedUrl(path.join(root, "a.ts"), -1), assert.AssertionError);
        assert.throws(() => numberedUrl(path.join(root, "a.ts"), 1.5), assert.AssertionError);
    });
});

describe("hasType", () => {
    test("an object whose type is a string has a type", () => {
        assert.equal(hasType(JSON.parse("{ \"type\": \"module\" }")), true);
        assert.equal(hasType(JSON.parse("{ \"type\": \"\" }")), true);
    });

    test("anything else has none", () => {
        for (const text of ["null", "1", "\"module\"", "{}", "{ \"type\": 1 }", "[]"]) {
            assert.equal(hasType(JSON.parse(text)), false, text);
        }
    });
});

describe("packageType", () => {
    test("no package.json gives no type", async () => {
        assert.equal(await packageType(projectLoader(), undefined), "");
    });

    test("a package.json gives its type, read once", async () => {
        const files = projectFileSystem();
        const loader = loaderOver(files);
        assert.equal(await packageType(loader, path.join(root, "old/package.json")), "commonjs");
        assert.equal(await packageType(loader, path.join(root, "package.json")), "module");
        assert.equal(await packageType(loader, path.join(root, "untyped/package.json")), "");
        assert.equal(loader.packageTypes.size, 3);
        files.files.set(path.join(root, "old/package.json"), "{ \"name\": \"old\", \"type\": \"module\" }\n");
        files.files.set(path.join(root, "untyped/package.json"), "{ \"name\": \"untyped\", \"type\": \"module\" }\n");
        assert.equal(await packageType(loader, path.join(root, "old/package.json")), "commonjs");
        assert.equal(await packageType(loader, path.join(root, "untyped/package.json")), "");
    });

    test("a package.json that cannot be read fails with the reading's own error", async () => {
        const files = projectFileSystem();
        files.failNext(path.join(root, "package.json"), "EACCES");
        await assert.rejects(packageType(loaderOver(files), path.join(root, "package.json")), {
            code: "EACCES",
        });
    });

    test("a path that is not a package.json is refused", async () => {
        await assert.rejects(packageType(projectLoader(), path.join(root, "app/tsconfig.json")), assert.AssertionError);
        await assert.rejects(packageType(projectLoader(), "package.json"), assert.AssertionError);
    });
});

describe("compilerOptions", () => {
    test("a file gets the options of the tsconfig.json that owns it, read once", async () => {
        const loader = projectLoader();
        const owned = await compilerOptions(loader, path.join(root, "app/src/main.ts"));
        assert.deepEqual(owned.paths, {
            "@lib/*": ["src/lib/*"],
        });
        assert.equal(await compilerOptions(loader, path.join(root, "app/src/helper.ts")), owned);
        assert.equal(loader.options.size, 1);
    });

    test("a file no tsconfig.json owns gets the defaults", async () => {
        const loader = projectLoader();
        const options = await compilerOptions(loader, path.join(root, "loose.ts"));
        assert.equal(options.paths, undefined);
        assert.deepEqual([...loader.options.keys()], [""]);
    });

    test("a relative path is refused", async () => {
        await assert.rejects(compilerOptions(projectLoader(), "loose.ts"), assert.AssertionError);
    });
});

describe("isProjectFile", () => {
    test("a file under the root and outside node_modules is the project's", () => {
        const settings = projectLoader().settings;
        assert.equal(isProjectFile(settings, path.join(root, "app/src/main.ts")), true);
        assert.equal(isProjectFile(settings, path.join(root, "app/node_modules/some-package/index.js")), false);
        assert.equal(isProjectFile(settings, "/work/elsewhere.ts"), false);
        assert.equal(isProjectFile(settings, `${root}-sibling/file.ts`), false);
    });

    test("a relative path is refused", () => {
        const settings = projectLoader().settings;
        assert.throws(() => isProjectFile(settings, "app/src/main.ts"), assert.AssertionError);
    });
});

describe("isInside", () => {
    test("only a file below the directory is inside it", () => {
        assert.equal(isInside("/one/two", "/one/two/three.ts"), true);
        assert.equal(isInside("/one/two", "/one/two"), false);
        assert.equal(isInside("/one/two", "/one/twofold/three.ts"), false);
        assert.throws(() => isInside("relative", "/one/two.ts"), assert.AssertionError);
        assert.throws(() => isInside("/one", "two.ts"), assert.AssertionError);
    });
});

describe("fileOf", () => {
    test("a file URL gives its path without its query and any other URL gives nothing", () => {
        assert.equal(fileOf(pathToFileURL("/one/two.ts").href), "/one/two.ts");
        assert.equal(fileOf(`${pathToFileURL("/one/two.ts").href}?flt=3`), "/one/two.ts");
        assert.equal(fileOf("node:fs"), undefined);
        assert.equal(fileOf("data:text/javascript,"), undefined);
        assert.equal(fileOf(undefined), undefined);
    });
});

describe("createLoader", () => {
    test("a loader starts with nothing read", () => {
        const loader = projectLoader();
        assert.equal(loader.options.size, 0);
        assert.equal(loader.packageTypes.size, 0);
        assert.equal(loader.transpiled.size, 0);
        assert.equal(loader.reading.known.misses.length, 0);
    });

    test("a relative project root or tool directory is refused", () => {
        assert.throws(() => createLoader({
            projectRoot: "project",
            toolModules,
        }, projectFileSystem()), assert.AssertionError);
        assert.throws(() => createLoader({
            projectRoot: root,
            toolModules: "src",
        }, projectFileSystem()), assert.AssertionError);
    });
});
