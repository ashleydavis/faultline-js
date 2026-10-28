//
// Finds the files a run exercises by walking the tree, so adding, renaming, moving or removing one
// changes the run without anything being typed.
//

import assert from "node:assert/strict";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { isCodedError, type IDirectoryEntry, type IFileSystem } from "../lib/file-system.ts";

//
// The directory names a walk skips where they sit at the root of the project and nowhere else.
//
// Each is a name a build writes its output under, and a build writes it beside the project rather
// than inside its source. Anywhere else the same name is the project's own code, such as a
// `src/build` directory holding what builds the program, so it is walked there.
//
export const skippedAtTheRoot = ["dist", "build", "out", "coverage"];

//
// The extensions a walk takes as source: every extension TypeScript and Node load JavaScript or
// TypeScript from.
//
export const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx"];

//
// The most directories a walk reads. A project's own tree, with installed packages and a build's
// output left out, holds far fewer, so a walk past this is reading something it should not, and
// stopping beats a walk that runs for hours.
//
export const directoriesMost = 1000000;

//
// One file the walk found, and what it is for.
//
export interface FoundFile {
    //
    // The path relative to the root of the run.
    //
    file: string;

    //
    // The path on disk.
    //
    full: string;

    //
    // The sim file beside it, when there is one.
    //
    sim?: string;
}

//
// One file or directory a walk left out, and why, so the report can say what was not tested.
//
export interface ISkippedFile {
    //
    // The path relative to the root of the run.
    //
    file: string;

    //
    // Why it was left out, as a clause the report finishes a sentence with.
    //
    because: string;
}

//
// What a walk found.
//
export interface Walked {
    //
    // The files a run exercises, in the order they sort.
    //
    sources: FoundFile[];

    //
    // Every sim file the walk found, by its path relative to the root, with the path on disk.
    //
    sims: Map<string, string>;

    //
    // The `global.sim.ts` files, relative to the root, in the order they sort. Their value
    // factories are used for the functions in every file.
    //
    globalSims: string[];

    //
    // The files and directories left out, each with the reason.
    //
    skipped: ISkippedFile[];
}

//
// What a walk is told.
//
export interface IWalkOptions {
    //
    // The directory the run started in, which every path is reported relative to.
    //
    root: string;

    //
    // The files and directories to test, relative to the root. Left empty, every file is tested.
    //
    include: string[];

    //
    // The files and directories to leave out, relative to the root.
    //
    exclude: string[];
}

//
// The name of Faultline's configuration file, at the root of the project. It is a file of its own,
// as Jest's is, so the settings of one tool do not sit among a package's own fields.
//
export const configFileName = "faultline.config.yaml";

//
// The keys the configuration file may hold. Any other key is refused, because a misspelt key that
// was ignored would test files the person did not choose.
//
export const configKeys = ["include", "exclude"];

//
// What the configuration file of a project chooses.
//
export interface ISelection {
    //
    // The files and directories to test, relative to the root.
    //
    include: string[];

    //
    // The files and directories to leave out, relative to the root.
    //
    exclude: string[];
}

//
// Which key of the configuration file a list of paths is read from.
//
export type SelectionKey = "include" | "exclude";

//
// Why the configuration file of a project could not be read.
//
export interface ISelectionError {
    //
    // Which error it is.
    //
    name: "unreadable-config-file" | "invalid-config-file";

    //
    // A sentence for the person running Faultline, saying what is wrong and where.
    //
    message: string;
}

//
// A selection that was read.
//
export interface ISelectionRead {
    //
    // It was read.
    //
    ok: true;

    //
    // What it chooses.
    //
    value: ISelection;
}

//
// A selection, or a list of paths in it, that could not be read.
//
export interface ISelectionFailed {
    //
    // It was not read.
    //
    ok: false;

    //
    // Why.
    //
    error: ISelectionError;
}

//
// What reading the selection gives back: the selection, or why there is none.
//
export type SelectionResult = ISelectionRead | ISelectionFailed;

//
// One list of paths of the selection that was read.
//
export interface IPathsRead {
    //
    // It was read.
    //
    ok: true;

    //
    // The paths, each written the one way.
    //
    value: string[];
}

//
// What reading one list of paths gives back: the paths, or why they cannot be used.
//
export type PathsResult = IPathsRead | ISelectionFailed;

//
// The selection of a project that names none: every file, with none left out.
//
export const everythingSelected: ISelectionRead = {
    ok: true,
    value: {
        include: [],
        exclude: [],
    },
};

//
// Reads `include` and `exclude` from the configuration file at the root of the project.
//
// A project with no configuration file, or an empty one, tests every file. Anything else that is
// not a mapping of known keys to lists of paths inside the project is an error, because a run that
// quietly tested something other than what was asked for would report a percentage of the wrong
// code.
//
export async function readSelection(fileSystem: IFileSystem, root: string): Promise<SelectionResult> {
    assert.ok(path.isAbsolute(root), `${root} is not an absolute path.`);
    const file = path.join(root, configFileName);
    let text: string;
    try {
        text = await fileSystem.readText(file);
        assert.equal(typeof text, "string");
    }
    catch (error) {
        if (isCodedError(error)) {
            if (error.code === "ENOENT") {
                return everythingSelected;
            }
        }
        return failedSelection("unreadable-config-file", `Faultline could not read ${configFileName}: ${messageOf(error)}.`);
    }
    //
    // The text is the project's, so what it parses to is not known until it is looked at.
    //
    let parsed: unknown;
    try {
        parsed = parseYaml(text, {
            strict: true,
            uniqueKeys: true,
            prettyErrors: true,
        });
    }
    catch (error) {
        return failedSelection("unreadable-config-file", `The ${configFileName} is not valid YAML: ${yamlErrorMessage(error)}.`);
    }
    //
    // An empty file, or one holding only comments, parses to `null` and chooses nothing.
    //
    if (parsed === null) {
        return everythingSelected;
    }
    if (!isRecord(parsed)) {
        return failedSelection("invalid-config-file", `The ${configFileName} has to be a mapping holding "include" and "exclude".`);
    }
    const unknownKey = Object.keys(parsed).find((key) => !configKeys.includes(key));
    //
    // Compared with `undefined` rather than tested for truth, because YAML allows an empty key and
    // that is refused too.
    //
    if (unknownKey !== undefined) {
        return failedSelection("invalid-config-file", `The ${configFileName} holds the key ${JSON.stringify(unknownKey)}, and it may hold only "include" and "exclude".`);
    }
    const include = pathList(parsed.include, "include");
    if (!include.ok) {
        return include;
    }
    const exclude = pathList(parsed.exclude, "exclude");
    if (!exclude.ok) {
        return exclude;
    }
    assert.ok(include.value.every((entry) => !path.posix.isAbsolute(entry)));
    assert.ok(exclude.value.every((entry) => !path.posix.isAbsolute(entry)));
    return {
        ok: true,
        value: {
            include: include.value,
            exclude: exclude.value,
        },
    };
}

//
// The message of something thrown: an error's own message, or the value written out. What a
// third-party call throws is not typed, so any value is taken.
//
export function messageOf(thrown: unknown): string {
    if (thrown instanceof Error) {
        return thrown.message;
    }
    return String(thrown);
}

//
// The first line of what the YAML parser threw, without the colon that leads into the excerpt of
// the file it prints below it, so the sentence it ends up in stays on one line and still says
// where in the file the problem is.
//
export function yamlErrorMessage(thrown: unknown): string {
    const message = messageOf(thrown);
    const firstLine = message.split("\n")[0];
    assert.ok(firstLine !== undefined);
    const trimmed = firstLine.trim().replace(/:$/, "");
    assert.ok(!trimmed.includes("\n"));
    return trimmed;
}

//
// A selection that could not be read, for the reason given.
//
export function failedSelection(name: ISelectionError["name"], message: string): ISelectionFailed {
    assert.ok(message.endsWith("."), `The message "${message}" is not a sentence.`);
    assert.equal(message[0], message[0]?.toUpperCase(), `The message "${message}" does not start with a capital.`);
    return {
        ok: false,
        error: {
            name,
            message,
        },
    };
}

//
// Whether a value read from YAML is a mapping, so its keys can be read. A value read from YAML can
// be anything, so any value is taken.
//
export function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object") {
        return false;
    }
    if (value === null) {
        return false;
    }
    return !Array.isArray(value);
}

//
// The paths one key lists, written the one way, or why they cannot be used. The value is read from
// YAML, so any value is taken.
//
export function pathList(value: unknown, key: SelectionKey): PathsResult {
    if (value === undefined) {
        return {
            ok: true,
            value: [],
        };
    }
    if (!Array.isArray(value)) {
        return failedSelection("invalid-config-file", `"${key}" in ${configFileName} has to be a list of paths.`);
    }
    const entries: unknown[] = value;
    const paths: string[] = [];
    for (const entry of entries) {
        if (typeof entry !== "string") {
            return failedSelection("invalid-config-file", `"${key}" in ${configFileName} has to hold only paths, and ${JSON.stringify(entry)} is not one.`);
        }
        if (entry.length === 0) {
            return failedSelection("invalid-config-file", `"${key}" in ${configFileName} has to hold only paths, and "" is not one.`);
        }
        const normalised = path.posix.normalize(toPosix(entry));
        if (isOutsideProject(normalised)) {
            return failedSelection("invalid-config-file", `"${key}" in ${configFileName} holds ${JSON.stringify(entry)}, which is outside the project. Write paths relative to the project root.`);
        }
        paths.push(normalised.replace(/\/+$/, ""));
    }
    assert.equal(paths.length, entries.length);
    assert.ok(paths.every((written) => written.length > 0));
    assert.ok(paths.every((written) => !path.posix.isAbsolute(written)));
    return {
        ok: true,
        value: paths,
    };
}

//
// Whether a path, written the one way and normalised, leads outside the project root: an absolute
// path, or one that climbs above the root.
//
export function isOutsideProject(normalised: string): boolean {
    assert.ok(normalised.length > 0);
    assert.equal(normalised, path.posix.normalize(normalised), `${normalised} is not normalised.`);
    if (path.posix.isAbsolute(normalised)) {
        return true;
    }
    if (normalised === "..") {
        return true;
    }
    return normalised.startsWith("../");
}

//
// Whether `file` is `entry` or sits under it, both relative to the root. The root itself, written
// `.`, holds everything.
//
export function isWithin(file: string, entry: string): boolean {
    assert.ok(!path.posix.isAbsolute(file), `${file} is not relative to the root.`);
    assert.ok(!path.posix.isAbsolute(entry), `${entry} is not relative to the root.`);
    if (entry === ".") {
        return true;
    }
    if (file === entry) {
        return true;
    }
    return file.startsWith(`${entry}/`);
}

//
// Whether this file is a sim file, which holds value factories, scenarios and expectation functions
// rather than code to exercise.
//
export function isSimFile(file: string): boolean {
    assert.ok(file.length > 0);
    return /\.sim\.[cm]?[jt]sx?$/.test(file);
}

//
// Whether this sim file is a `global.sim.ts`, whose value factories every file uses.
//
export function isGlobalSimFile(file: string): boolean {
    assert.ok(file.length > 0);
    return /^global\.sim\.[cm]?[jt]sx?$/.test(path.posix.basename(file));
}

//
// Whether this file is a test of its own, which calls the code rather than being code to exercise.
//
export function isTestFile(file: string): boolean {
    assert.ok(file.length > 0);
    return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

//
// Whether this file only declares types, so there is no code in it to run.
//
export function isDeclarationFile(file: string): boolean {
    assert.ok(file.length > 0);
    return /\.d\.[cm]?ts$/.test(file);
}

//
// The sim file a source file would have, whether or not it is there.
//
export function simFileFor(file: string): string {
    const dot = file.lastIndexOf(".");
    assert.ok(dot > 0, `${file} has no extension.`);
    const sim = `${file.slice(0, dot)}.sim${file.slice(dot)}`;
    assert.ok(isSimFile(sim));
    assert.equal(sim.length, file.length + ".sim".length);
    return sim;
}

//
// Walks the tree and says what a run exercises.
//
// The whole tree is walked even when `include` names only part of it, because a sim file beside an
// included file and every `global.sim.ts` count wherever they sit, and because every file left out
// is named in the report with the reason.
//
export async function walkSources(fileSystem: IFileSystem, options: IWalkOptions): Promise<Walked> {
    const root = path.resolve(options.root);
    assert.ok(options.include.every((entry) => !path.posix.isAbsolute(entry)));
    assert.ok(options.exclude.every((entry) => !path.posix.isAbsolute(entry)));
    const walk: IWalkState = {
        fileSystem,
        options,
        found: [],
        skipped: [],
        directories: [
            {
                directory: root,
                relative: "",
            },
        ],
    };
    //
    // Each turn reads one directory and adds the ones inside it. The tree is finite and the walk
    // follows no links, so the queue ends, and `directoriesMost` stops a tree too big to be a
    // project's own.
    //
    for (let next = 0; next < walk.directories.length; next += 1) {
        assert.ok(next < directoriesMost, `The walk under ${root} found more than ${directoriesMost} directories. Leave out what is not the project's own code with "exclude" in ${configFileName}.`);
        const directory = walk.directories[next];
        assert.ok(directory);
        await readDirectory(walk, directory);
    }
    const named = new Set<string>();

    const sims = new Map<string, string>();
    const sources: FoundFile[] = [];
    for (const one of walk.found.sort((left, right) => left.file.localeCompare(right.file))) {
        if (isDeclarationFile(one.file)) {
            walk.skipped.push({
                file: one.file,
                because: "it declares types and holds no code to run",
            });
            continue;
        }
        if (isSimFile(one.file)) {
            sims.set(one.file, one.full);
            continue;
        }
        if (isTestFile(one.file)) {
            walk.skipped.push({
                file: one.file,
                because: "it is a test of its own, so it calls the code rather than being code to exercise",
            });
            continue;
        }
        if (options.include.length > 0) {
            const includedBy = options.include.find((entry) => isWithin(one.file, entry));
            if (!includedBy) {
                walk.skipped.push({
                    file: one.file,
                    because: "it is outside every path named in include",
                });
                continue;
            }
            named.add(includedBy);
        }
        sources.push(one);
    }

    const pairedSims = new Set<string>();
    for (const one of sources) {
        const wanted = simFileFor(one.file);
        if (sims.has(wanted)) {
            one.sim = sims.get(wanted);
            pairedSims.add(wanted);
        }
    }

    const globalSims: string[] = [];
    for (const file of sims.keys()) {
        if (isGlobalSimFile(file)) {
            globalSims.push(file);
            continue;
        }
        if (!pairedSims.has(file)) {
            walk.skipped.push({
                file,
                because: "it is a sim file with no tested source file beside it, so no function uses what it holds",
            });
        }
    }

    for (const entry of options.include) {
        if (!named.has(entry)) {
            walk.skipped.push({
                file: entry,
                because: "it is named in include and no source file is there",
            });
        }
    }

    walk.skipped.sort((left, right) => left.file.localeCompare(right.file));
    assert.ok(sources.every((one) => !isSimFile(one.file)));
    assert.ok(globalSims.every((file) => sims.has(file)));
    return {
        sources,
        sims,
        globalSims,
        skipped: walk.skipped,
    };
}

//
// One directory a walk has still to read.
//
export interface IWalkDirectory {
    //
    // The path on disk.
    //
    directory: string;

    //
    // Its path from the root, or the empty string for the root itself.
    //
    relative: string;
}

//
// What a walk keeps while it reads the tree.
//
export interface IWalkState {
    //
    // Where the tree is read from.
    //
    fileSystem: IFileSystem;

    //
    // What the walk was told.
    //
    options: IWalkOptions;

    //
    // Every source and sim file found so far.
    //
    found: FoundFile[];

    //
    // Every file and directory left out so far, with why.
    //
    skipped: ISkippedFile[];

    //
    // Every directory found so far, the ones read and the ones still to read, in the order found.
    //
    directories: IWalkDirectory[];
}

//
// Whether an `include` entry names this directory or something under it, so a directory skipped by
// default is walked when the project asks for what is inside it. The root, written `.`, names no
// directory in particular.
//
export function isIncludedBeneath(include: string[], directory: string): boolean {
    assert.ok(directory.length > 0);
    assert.ok(!path.posix.isAbsolute(directory), `${directory} is not relative to the root.`);
    return include.some((entry) => {
        if (entry === ".") {
            return false;
        }
        return isWithin(entry, directory);
    });
}

//
// Reads one directory: each file goes in `found` or `skipped`, and each directory the walk goes
// into joins the directories still to read.
//
export async function readDirectory(walk: IWalkState, at: IWalkDirectory): Promise<void> {
    assert.ok(path.isAbsolute(at.directory), `${at.directory} is not an absolute path.`);
    assert.ok(!path.posix.isAbsolute(at.relative), `${at.relative} is not relative to the root.`);
    let entries: IDirectoryEntry[];
    try {
        entries = await walk.fileSystem.listDirectory(at.directory);
    }
    catch (error) {
        //
        // A directory that cannot be read is named in the report rather than stopping the run,
        // because a directory another user owns is common in a project's tree and is not the
        // project's defect.
        //
        walk.skipped.push({
            file: at.relative,
            because: `it could not be read (${messageOf(error)})`,
        });
        return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        assert.ok(!entry.name.includes("/"), `The entry ${entry.name} of ${at.directory} holds a separator.`);
        const file = at.relative === "" ? entry.name : `${at.relative}/${entry.name}`;
        const because = skipReason(walk.options, at.relative, file, entry);
        if (because) {
            walk.skipped.push({
                file,
                because,
            });
            continue;
        }
        const full = path.join(at.directory, entry.name);
        if (entry.kind === "directory") {
            walk.directories.push({
                directory: full,
                relative: file,
            });
            continue;
        }
        if (!sourceExtensions.includes(path.extname(entry.name))) {
            //
            // A file in another language is not a JavaScript or TypeScript file that was left out,
            // so it is not listed: listing every stylesheet and image would bury the files that
            // were.
            //
            continue;
        }
        walk.found.push({
            file,
            full,
        });
    }
}

//
// Why the walk leaves out one entry of the directory at `relative`, as a clause the report
// finishes a sentence with, or the empty string when it takes the entry. `file` is the entry's
// path from the root.
//
export function skipReason(options: IWalkOptions, relative: string, file: string, entry: IDirectoryEntry): string {
    assert.ok(entry.name.length > 0);
    assert.ok(file.endsWith(entry.name), `${file} does not end in the entry's name ${entry.name}.`);
    assert.ok(!path.posix.isAbsolute(relative), `${relative} is not relative to the root.`);
    if (options.exclude.some((one) => isWithin(file, one))) {
        return "it is named in exclude";
    }
    if (entry.kind === "directory") {
        if (entry.name === "node_modules") {
            return "it holds installed packages, not the project's own code";
        }
        if (entry.name.startsWith(".")) {
            return "its name starts with a dot, so it holds a tool's own files";
        }
        if (relative === "") {
            if (skippedAtTheRoot.includes(entry.name)) {
                if (!isIncludedBeneath(options.include, file)) {
                    return "it is where a build writes its output";
                }
            }
        }
        return "";
    }
    if (entry.kind === "file") {
        return "";
    }
    //
    // A symbolic link is not followed, so a file the link points at inside the project is never
    // tested twice and one outside it is never tested at all.
    //
    return "it is not a regular file or directory, and the walk follows no links";
}

//
// A path written the one way, so a report reads the same on every machine.
//
export function toPosix(file: string): string {
    const written = file.split(path.sep).join("/");
    assert.equal(written.length, file.length);
    return written;
}
