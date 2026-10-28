//
// Tests the walk that finds the files a run exercises and the reading of `include` and `exclude`
// from `faultline.config.yaml`. Each test puts a small tree of empty files in a file system in memory under
// `root`, walks it and checks what was found and what was left out with which reason.
//

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "@jest/globals";
import { createFakeFileSystem, type IFakeFileSystem } from "../lib/fake-files.test.ts";
import {
    configFileName,
    configKeys,
    everythingSelected,
    failedSelection,
    isDeclarationFile,
    isGlobalSimFile,
    isIncludedBeneath,
    isOutsideProject,
    isRecord,
    isSimFile,
    isTestFile,
    isWithin,
    messageOf,
    pathList,
    readDirectory,
    readSelection,
    simFileFor,
    skippedAtTheRoot,
    skipReason,
    sourceExtensions,
    toPosix,
    yamlErrorMessage,
    walkSources,
    type IWalkOptions,
    type IWalkState,
    type SelectionKey,
    type SelectionResult,
} from "./sources.ts";

//
// The directory every tree sits in. It is under the file system's root so it is absolute on every
// machine, and it is never read from the disk because every tree is in memory.
//
export const root = path.join(path.parse(process.cwd()).root, "walk");

//
// A file system in memory holding a tree of empty files under `root`.
//
export function tree(paths: string[]): IFakeFileSystem {
    const files: Record<string, string> = {};
    for (const one of paths) {
        files[path.join(root, one)] = "";
    }
    return createFakeFileSystem(files);
}

describe("isSimFile", () => {
    test("a sim file is told by its name", () => {
        assert.equal(isSimFile("a.sim.ts"), true);
        assert.equal(isSimFile("a/b.sim.mts"), true);
        assert.equal(isSimFile("a.sim.js"), true);
        assert.equal(isSimFile("a.ts"), false);
        assert.equal(isSimFile("simple.ts"), false);
    });
});

describe("isTestFile", () => {
    test("a test of its own is told by its name", () => {
        assert.equal(isTestFile("a.test.ts"), true);
        assert.equal(isTestFile("a.spec.js"), true);
        assert.equal(isTestFile("a.ts"), false);
        assert.equal(isTestFile("latest.ts"), false);
    });
});

describe("isDeclarationFile", () => {
    test("a file that only declares types is told by its name", () => {
        assert.equal(isDeclarationFile("a.d.ts"), true);
        assert.equal(isDeclarationFile("a.d.mts"), true);
        assert.equal(isDeclarationFile("a.d.cts"), true);
        assert.equal(isDeclarationFile("a.ts"), false);
        assert.equal(isDeclarationFile("a.d.js"), false);
    });
});

describe("simFileFor", () => {
    test("the sim file a source file would have carries its extension", () => {
        assert.equal(simFileFor("a/b.ts"), "a/b.sim.ts");
        assert.equal(simFileFor("a.mjs"), "a.sim.mjs");
    });

    test("a file with no extension is a programmer error", () => {
        assert.throws(() => simFileFor("Makefile"), /has no extension/);
        assert.throws(() => simFileFor(".ts"), /has no extension/);
    });
});

describe("toPosix", () => {
    test("a path is written the one way", () => {
        assert.equal(toPosix(path.join("a", "b", "c.ts")), "a/b/c.ts");
        assert.equal(toPosix("a.ts"), "a.ts");
    });
});

describe("walkSources", () => {
    test("the walk finds every source file under the root", async () => {
        const files = tree(["a.ts", "deep/b.ts", "deep/deeper/c.js"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts", "deep/b.ts", "deep/deeper/c.js"],
        );
    });

    test("the walk sorts what it found, so a run reads the same twice", async () => {
        const files = tree(["z.ts", "a.ts", "m.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts", "m.ts", "z.ts"],
        );
    });

    test("the walk never descends into installed packages or a directory whose name starts with a dot, at any depth", async () => {
        const files = tree(["a.ts", "node_modules/x/hidden.ts", ".git/hidden.ts", "deep/.cache/hidden.ts", "deep/node_modules/hidden.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts"],
        );
        assert.deepEqual(
            walked.skipped.map((one) => one.file),
            [".git", "deep/.cache", "deep/node_modules", "node_modules"],
        );
        assert.ok(walked.skipped.find((one) => one.file === "node_modules")!.because.includes("installed packages"));
        assert.ok(walked.skipped.find((one) => one.file === ".git")!.because.includes("dot"));
    });

    test("a build's output directory is skipped at the root and walked anywhere else", async () => {
        const files = tree([...skippedAtTheRoot.map((name) => `${name}/hidden.ts`), "src/build/kept.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["src/build/kept.ts"],
        );
        assert.deepEqual(walked.skipped.map((one) => one.file), [...skippedAtTheRoot].sort());
        assert.ok(walked.skipped.every((one) => one.because.includes("build")));
    });

    test("a build's output directory is walked when include names something in it", async () => {
        const files = tree(["build/generated.ts", "build/other.ts"]);
        const walked = await walkSources(files, {
            root,
            include: ["build/generated.ts"],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["build/generated.ts"],
        );
    });

    test("a directory named in exclude is left out, with the reason", async () => {
        const files = tree(["a.ts", "bench/b.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: ["bench"],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts"],
        );
        assert.deepEqual(walked.skipped, [{
            file: "bench",
            because: "it is named in exclude",
        }]);
    });

    test("a file named in exclude is left out, with the reason", async () => {
        const files = tree(["a.ts", "b.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: ["b.ts"],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts"],
        );
        assert.deepEqual(walked.skipped, [{
            file: "b.ts",
            because: "it is named in exclude",
        }]);
    });

    test("exclude matches a path from the root, not a name anywhere in the tree", async () => {
        const files = tree(["tools/harness.ts", "tools/helper.ts", "lib/tools/kept.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: ["tools/harness.ts"],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["lib/tools/kept.ts", "tools/helper.ts"],
        );
        const nested = await walkSources(files, {
            root,
            include: [],
            exclude: ["tools"],
        });
        assert.deepEqual(
            nested.sources.map((one) => one.file),
            ["lib/tools/kept.ts"],
        );
    });

    test("only the files and directories named in include are tested, and every other file says why", async () => {
        const files = tree(["lib/text/casing.ts", "lib/io/reader.ts", "main.ts", "scripts/generate.ts"]);
        const walked = await walkSources(files, {
            root,
            include: ["lib/text", "lib/io", "main.ts"],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["lib/io/reader.ts", "lib/text/casing.ts", "main.ts"],
        );
        assert.deepEqual(walked.skipped, [{
            file: "scripts/generate.ts",
            because: "it is outside every path named in include",
        }]);
    });

    test("exclude wins over include for what is inside both", async () => {
        const files = tree(["lib/a.ts", "lib/b.ts"]);
        const walked = await walkSources(files, {
            root,
            include: ["lib"],
            exclude: ["lib/b.ts"],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["lib/a.ts"],
        );
    });

    test("an include path with no source file there is named, so a typing mistake is seen", async () => {
        const files = tree(["a.ts"]);
        const walked = await walkSources(files, {
            root,
            include: ["a.ts", "missing"],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts"],
        );
        assert.deepEqual(walked.skipped, [{
            file: "missing",
            because: "it is named in include and no source file is there",
        }]);
    });

    test("an include of the root itself takes every file", async () => {
        const files = tree(["a.ts", "deep/b.ts"]);
        const walked = await walkSources(files, {
            root,
            include: ["."],
            exclude: [],
        });
        assert.equal(walked.sources.length, 2);
        assert.deepEqual(walked.skipped, []);
    });

    test("a sim file beside an included file is paired with it although include does not name it", async () => {
        const files = tree(["main.ts", "main.sim.ts", "lib/global.sim.ts"]);
        const walked = await walkSources(files, {
            root,
            include: ["main.ts"],
            exclude: [],
        });
        assert.equal(walked.sources[0]?.sim, path.join(root, "main.sim.ts"));
        assert.deepEqual(walked.globalSims, ["lib/global.sim.ts"]);
    });

    test("every global.sim.ts is found wherever it sits, and is not reported as left out", async () => {
        const files = tree(["a.ts", "global.sim.ts", "deep/global.sim.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(walked.globalSims, ["deep/global.sim.ts", "global.sim.ts"]);
        assert.deepEqual(walked.skipped, []);
    });

    test("a sim file with no tested source file beside it is named with the reason", async () => {
        const files = tree(["a.ts", "lonely.sim.ts", "b.ts", "b.sim.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: ["b.ts"],
        });
        assert.deepEqual(
            walked.skipped.map((one) => one.file),
            ["b.sim.ts", "b.ts", "lonely.sim.ts"],
        );
        assert.ok(walked.skipped[0]!.because.includes("no tested source file beside it"));
    });

    test("a sim file is kept apart from the source it sits beside", async () => {
        const files = tree(["a.ts", "a.sim.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts"],
        );
        assert.equal(walked.sources[0]?.sim, path.join(root, "a.sim.ts"));
        assert.equal(walked.sims.size, 1);
    });

    test("a source file with no sim file beside it says so", async () => {
        const files = tree(["a.ts"]);
        assert.equal((await walkSources(files, {
            root,
            include: [],
            exclude: [],
        })).sources[0]?.sim, undefined);
    });

    test("a test and a declaration are left out, each with its reason", async () => {
        const files = tree(["a.ts", "a.test.ts", "a.d.ts"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts"],
        );
        assert.deepEqual(walked.skipped.map((one) => one.file).sort(), ["a.d.ts", "a.test.ts"]);
        for (const one of walked.skipped) {
            assert.ok(one.because.length > 0);
        }
    });

    test("a file with an extension the walk does not take is left where it is", async () => {
        const files = tree(["a.ts", "notes.md", "data.json"]);
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts"],
        );
    });

    test("every extension the walk takes is found", async () => {
        const files = tree(sourceExtensions.map((extension, index) => `f${index}${extension}`));
        assert.equal((await walkSources(files, {
            root,
            include: [],
            exclude: [],
        })).sources.length, sourceExtensions.length);
    });

    test("a directory that cannot be read is named rather than stopping the walk", async () => {
        const files = tree(["a.ts"]);
        files.failNext(root, "EACCES");
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.equal(walked.sources.length, 0);
        assert.equal(walked.skipped.length, 1);
        assert.equal(walked.skipped[0]!.file, "");
        assert.ok(walked.skipped[0]!.because.startsWith("it could not be read ("));
    });

    test("an entry that is neither a file nor a directory is named and not followed", async () => {
        const files = tree(["a.ts"]);
        files.others.add(path.join(root, "b.ts"));
        const walked = await walkSources(files, {
            root,
            include: [],
            exclude: [],
        });
        assert.deepEqual(
            walked.sources.map((one) => one.file),
            ["a.ts"],
        );
        assert.deepEqual(walked.skipped.map((one) => one.file), ["b.ts"]);
        assert.ok(walked.skipped[0]!.because.includes("follows no links"));
    });
});

describe("isGlobalSimFile", () => {
    test("a global sim file is told by its name wherever it sits", () => {
        assert.equal(isGlobalSimFile("global.sim.ts"), true);
        assert.equal(isGlobalSimFile("deep/global.sim.mts"), true);
        assert.equal(isGlobalSimFile("myglobal.sim.ts"), false);
        assert.equal(isGlobalSimFile("global.ts"), false);
    });
});

describe("isWithin", () => {
    test("a path is within itself and the directories above it, and the root holds every path", () => {
        assert.equal(isWithin("lib/a.ts", "lib"), true);
        assert.equal(isWithin("lib", "lib"), true);
        assert.equal(isWithin("library/a.ts", "lib"), false);
        assert.equal(isWithin("a.ts", "."), true);
    });

    test("a path that is not relative to the root is a programmer error", () => {
        assert.throws(() => isWithin(path.join(root, "a.ts"), "lib"), /not relative to the root/);
        assert.throws(() => isWithin("a.ts", path.join(root, "lib")), /not relative to the root/);
    });
});

describe("isRecord", () => {
    test("a value read from JSON is a record only when it is an object that is not a list", () => {
        assert.equal(isRecord({}), true);
        assert.equal(isRecord([]), false);
        assert.equal(isRecord(null), false);
        assert.equal(isRecord("text"), false);
    });
});

describe("pathList", () => {
    test("a list of paths is written the one way", () => {
        assert.deepEqual(pathList(undefined, "include"), {
            ok: true,
            value: [],
        });
        assert.deepEqual(pathList(["./lib/", "a//b.ts", ".", "./"], "include"), {
            ok: true,
            value: ["lib", "a/b.ts", ".", "."],
        });
    });

    test("a path list that is not a list of paths inside the project says why", () => {
        assert.equal(refusalOf("lib", "include"), '"include" in faultline.config.yaml has to be a list of paths.');
        assert.equal(refusalOf([3], "exclude"), '"exclude" in faultline.config.yaml has to hold only paths, and 3 is not one.');
        assert.equal(refusalOf([""], "exclude"), '"exclude" in faultline.config.yaml has to hold only paths, and "" is not one.');
        assert.match(refusalOf(["/etc"], "include"), /outside the project/);
        assert.match(refusalOf(["/"], "include"), /outside the project/);
        assert.match(refusalOf(["../other"], "include"), /outside the project/);
        assert.match(refusalOf([".."], "include"), /outside the project/);
    });
});

describe("isOutsideProject", () => {
    test("an absolute path or one that climbs above the root is outside, and any other is inside", () => {
        assert.equal(isOutsideProject("/etc"), true);
        assert.equal(isOutsideProject(".."), true);
        assert.equal(isOutsideProject("../other"), true);
        assert.equal(isOutsideProject("lib"), false);
        assert.equal(isOutsideProject("."), false);
        assert.equal(isOutsideProject("..lib"), false);
    });

    test("a path that is not normalised is a programmer error", () => {
        assert.throws(() => isOutsideProject("a//b"), /not normalised/);
        assert.throws(() => isOutsideProject(""));
    });
});

describe("failedSelection", () => {
    test("a failed selection carries its name and sentence", () => {
        assert.deepEqual(failedSelection("invalid-config-file", "Wrong."), {
            ok: false,
            error: {
                name: "invalid-config-file",
                message: "Wrong.",
            },
        });
    });

    test("a message that is not a sentence is a programmer error", () => {
        assert.throws(() => failedSelection("invalid-config-file", "Wrong"), /not a sentence/);
        assert.throws(() => failedSelection("invalid-config-file", "wrong."), /capital/);
    });
});

describe("yamlErrorMessage", () => {
    test("the first line of the parser's message is kept, without the colon that leads into its excerpt", () => {
        assert.equal(yamlErrorMessage(new Error("Map keys must be unique at line 2, column 1:\n\ninclude: []\n^\n")), "Map keys must be unique at line 2, column 1");
        assert.equal(yamlErrorMessage(new Error("Broken")), "Broken");
        assert.equal(yamlErrorMessage("thrown text"), "thrown text");
    });
});

//
// The sentence `pathList` gives for a value it refuses, which has to be a refusal rather than a
// list.
//
export function refusalOf(value: unknown, key: SelectionKey): string {
    const listed = pathList(value, key);
    assert(!listed.ok, `pathList took ${JSON.stringify(value)} as a list of paths.`);
    assert.equal(listed.error.name, "invalid-config-file");
    return listed.error.message;
}

//
// Puts a configuration file with this text in a file system in memory and reads the selection.
//
export async function selectionOf(text: string | undefined): Promise<SelectionResult> {
    const files = tree([]);
    if (text !== undefined) {
        files.files.set(path.join(root, configFileName), text);
    }
    return readSelection(files, root);
}

describe("readSelection", () => {
    test("include and exclude are read from faultline.config.yaml", async () => {
        const read = await selectionOf("include:\n  - lib\n  - main.ts\nexclude:\n  - lib/bench\n");
        assert.deepEqual(read, {
            ok: true,
            value: {
                include: ["lib", "main.ts"],
                exclude: ["lib/bench"],
            },
        });
    });

    test("a project with no configuration file, an empty one or one with empty lists tests every file", async () => {
        assert.deepEqual(await selectionOf(undefined), everythingSelected);
        assert.deepEqual(await selectionOf(""), everythingSelected);
        assert.deepEqual(await selectionOf("# Nothing chosen yet.\n"), everythingSelected);
        assert.deepEqual(await selectionOf("{}\n"), everythingSelected);
        assert.deepEqual(await selectionOf("include: []\nexclude: []\n"), everythingSelected);
    });

    test("the settings in package.json are not read", async () => {
        const files = tree([]);
        files.files.set(path.join(root, "package.json"), '{ "faultline": { "include": ["lib"] } }');
        assert.deepEqual(await readSelection(files, root), everythingSelected);
    });

    test("a file that is not YAML is an error with a sentence that says where", async () => {
        const read = await selectionOf("include: [lib\n");
        assert.equal(read.ok, false);
        assert.equal(read.ok ? "" : read.error.name, "unreadable-config-file");
        assert.match(read.ok ? "" : read.error.message, /^The faultline\.config\.yaml is not valid YAML: .*line \d+, column \d+\.$/);
        assert.doesNotMatch(read.ok ? "" : read.error.message, /\n/);
    });

    test("a key written twice is an error", async () => {
        const read = await selectionOf("include: []\ninclude: []\n");
        assert.equal(read.ok ? "" : read.error.name, "unreadable-config-file");
        assert.match(read.ok ? "" : read.error.message, /unique/);
    });

    test("a file that cannot be read is an error with a sentence", async () => {
        const files = tree([]);
        files.failNext(path.join(root, configFileName), "EACCES");
        const read = await readSelection(files, root);
        assert.equal(read.ok ? "" : read.error.name, "unreadable-config-file");
        assert.match(read.ok ? "" : read.error.message, /^Faultline could not read faultline\.config\.yaml: EACCES/);
    });

    test("a file that fails with something other than an error Node raised is an error with a sentence", async () => {
        const files = tree([]);
        files.readText = () => Promise.reject(new Error("broken"));
        const read = await readSelection(files, root);
        assert.equal(read.ok ? "" : read.error.name, "unreadable-config-file");
        assert.equal(read.ok ? "" : read.error.message, "Faultline could not read faultline.config.yaml: broken.");
    });

    test("a file that is not a mapping, holds an unknown key or holds a bad list is an error", async () => {
        const notMapping = await selectionOf("- lib\n");
        assert.equal(notMapping.ok ? "" : notMapping.error.name, "invalid-config-file");
        assert.equal(notMapping.ok ? "" : notMapping.error.message, 'The faultline.config.yaml has to be a mapping holding "include" and "exclude".');
        const scalar = await selectionOf("lib\n");
        assert.equal(scalar.ok ? "" : scalar.error.name, "invalid-config-file");
        const misspelt = await selectionOf("exlude:\n  - bench\n");
        assert.equal(misspelt.ok ? "" : misspelt.error.message, 'The faultline.config.yaml holds the key "exlude", and it may hold only "include" and "exclude".');
        const emptyKey = await selectionOf('"": []\n');
        assert.equal(emptyKey.ok ? "" : emptyKey.error.message, 'The faultline.config.yaml holds the key "", and it may hold only "include" and "exclude".');
        const badInclude = await selectionOf("include: lib\n");
        assert.equal(badInclude.ok ? "" : badInclude.error.message, '"include" in faultline.config.yaml has to be a list of paths.');
        const badExclude = await selectionOf("exclude:\n  - ../x\n");
        assert.match(badExclude.ok ? "" : badExclude.error.message, /^"exclude" .*outside the project/);
    });

    test("a root that is not absolute is a programmer error", async () => {
        await assert.rejects(readSelection(tree([]), "walk"), /not an absolute path/);
    });
});

describe("configFileName and configKeys", () => {
    test("the configuration file is a YAML file of Faultline's own, holding include and exclude", () => {
        assert.equal(configFileName, "faultline.config.yaml");
        assert.deepEqual(configKeys, ["include", "exclude"]);
    });
});

describe("everythingSelected", () => {
    test("a project that names no selection tests every file and leaves none out", () => {
        assert.deepEqual(everythingSelected, {
            ok: true,
            value: {
                include: [],
                exclude: [],
            },
        });
    });
});

describe("messageOf", () => {
    test("an error gives its message and any other value is written out", () => {
        assert.equal(messageOf(new Error("broken")), "broken");
        assert.equal(messageOf("text"), "text");
        assert.equal(messageOf(undefined), "undefined");
    });
});

describe("isIncludedBeneath", () => {
    test("a directory is included beneath when an include entry names it or something in it, and the root names nothing", () => {
        assert.equal(isIncludedBeneath(["build/generated.ts"], "build"), true);
        assert.equal(isIncludedBeneath(["build"], "build"), true);
        assert.equal(isIncludedBeneath(["lib"], "build"), false);
        assert.equal(isIncludedBeneath(["."], "build"), false);
    });

    test("a directory that is not relative to the root is a programmer error", () => {
        assert.throws(() => isIncludedBeneath([], path.join(root, "build")), /not relative to the root/);
        assert.throws(() => isIncludedBeneath([], ""));
    });
});

describe("skipReason", () => {
    const options: IWalkOptions = {
        root,
        include: [],
        exclude: ["skipped"],
    };

    test("each kind of entry the walk leaves out gets its reason, and one it takes gets none", () => {
        assert.equal(skipReason(options, "", "skipped", {
            name: "skipped",
            kind: "file",
        }), "it is named in exclude");
        assert.equal(skipReason(options, "lib", "lib/node_modules", {
            name: "node_modules",
            kind: "directory",
        }), "it holds installed packages, not the project's own code");
        assert.equal(skipReason(options, "", ".git", {
            name: ".git",
            kind: "directory",
        }), "its name starts with a dot, so it holds a tool's own files");
        assert.equal(skipReason(options, "", "dist", {
            name: "dist",
            kind: "directory",
        }), "it is where a build writes its output");
        assert.equal(skipReason(options, "lib", "lib/dist", {
            name: "dist",
            kind: "directory",
        }), "");
        assert.equal(skipReason(options, "", "src", {
            name: "src",
            kind: "directory",
        }), "");
        assert.equal(skipReason(options, "", "link", {
            name: "link",
            kind: "other",
        }), "it is not a regular file or directory, and the walk follows no links");
        assert.equal(skipReason(options, "", "a.ts", {
            name: "a.ts",
            kind: "file",
        }), "");
    });

    test("a build's output directory at the root is taken when include names something in it", () => {
        const including: IWalkOptions = {
            root,
            include: ["dist/kept.ts"],
            exclude: [],
        };
        assert.equal(skipReason(including, "", "dist", {
            name: "dist",
            kind: "directory",
        }), "");
        assert.equal(skipReason(including, "", "out", {
            name: "out",
            kind: "directory",
        }), "it is where a build writes its output");
    });

    test("a path that does not end in the entry's name is a programmer error", () => {
        assert.throws(() => skipReason(options, "", "other", {
            name: "a.ts",
            kind: "file",
        }), /does not end in the entry's name/);
    });
});

describe("readDirectory", () => {
    test("one directory's files are found, its directories are queued and an unreadable one is named", async () => {
        const walk: IWalkState = {
            fileSystem: tree(["a.ts", "notes.md", "lib/b.ts", "node_modules/x/index.js"]),
            options: {
                root,
                include: [],
                exclude: [],
            },
            found: [],
            skipped: [],
            directories: [],
        };
        await readDirectory(walk, {
            directory: root,
            relative: "",
        });
        assert.deepEqual(walk.found.map((one) => one.file), ["a.ts"]);
        assert.deepEqual(walk.directories, [
            {
                directory: path.join(root, "lib"),
                relative: "lib",
            },
        ]);
        assert.deepEqual(walk.skipped.map((one) => one.file), ["node_modules"]);
        await readDirectory(walk, {
            directory: path.join(root, "missing"),
            relative: "missing",
        });
        assert.equal(walk.skipped[1]?.file, "missing");
        assert.match(walk.skipped[1]?.because ?? "", /^it could not be read \(ENOENT/);
    });
});
