// Finds the files a run exercises by walking the tree, so adding, renaming, moving or removing one
// changes the run without anything being typed.

import fs from "node:fs";
import path from "node:path";

// The directory names a walk never descends into, whatever the project asks for. Each is either
// somebody else's code or a build's own output, and neither is the project's to cover.
export const alwaysSkipped = [
    "node_modules",
    ".git",
    ".hg",
    ".svn",
    "dist",
    "build",
    "out",
    "coverage",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    "vendor",
];

// The extensions a walk takes as source.
export const sourceExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx"];

// One file the walk found, and what it is for.
export interface FoundFile {
    // The path relative to the root of the run.
    file: string;

    // The path on disk.
    full: string;

    // The sim file beside it, when there is one.
    sim?: string;
}

// What a walk found.
export interface Walked {
    // The files a run exercises, in the order they sort.
    sources: FoundFile[];

    // The sim files, by the source file each one sits beside.
    sims: Map<string, string>;

    // The files left out, each with the reason.
    skipped: { file: string; because: string }[];
}

// What a walk is told.
export interface WalkOptions {
    // The directory the run started in, which every path is reported relative to.
    root: string;

    // The directories to walk. Left empty, the walk takes the root itself.
    source: string[];

    // Extra names to leave out, beyond the ones above. A name matches a directory anywhere in the
    // tree, or one file by the path the report prints for it.
    exclude: string[];
}

// Whether this file is a sim file, which holds test input factories and scenarios rather than code
// to exercise.
export function isSimFile(file: string): boolean {
    return /\.sim\.[cm]?[jt]sx?$/.test(file);
}

// Whether this file is a test of its own, which is a harness rather than code to exercise.
export function isTestFile(file: string): boolean {
    return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

// Whether this file only declares types, so there is no code in it to run.
export function isDeclarationFile(file: string): boolean {
    return file.endsWith(".d.ts") || file.endsWith(".d.mts") || file.endsWith(".d.cts");
}

// The sim file a source file would have, whether or not it is there.
export function simFileFor(file: string): string {
    const dot = file.lastIndexOf(".");
    return `${file.slice(0, dot)}.sim${file.slice(dot)}`;
}

// Walks the tree and says what a run exercises.
export function walkSources(options: WalkOptions): Walked {
    const roots = options.source.length > 0 ? options.source : ["."];
    const skipNames = new Set([...alwaysSkipped, ...options.exclude]);
    const found: string[] = [];
    const skipped: { file: string; because: string }[] = [];

    for (const one of roots) {
        descend(path.resolve(options.root, one));
    }

    // Reads one directory and everything under it.
    function descend(directory: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        }
        catch {
            // A directory that cannot be read is named in the report rather than stopping the run,
            // because a tree under a symlink somebody else owns is common and is not the project's
            // defect.
            skipped.push({ file: path.relative(options.root, directory), because: "it could not be read" });
            return;
        }
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (skipNames.has(entry.name)) {
                    continue;
                }
                descend(full);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            if (!sourceExtensions.includes(path.extname(entry.name))) {
                continue;
            }
            found.push(full);
        }
    }

    const sims = new Map<string, string>();
    const sources: FoundFile[] = [];
    const relative = found
        .map((full) => ({ full, file: toPosix(path.relative(options.root, full)) }))
        .sort((left, right) => left.file.localeCompare(right.file));

    for (const one of relative) {
        if (skipNames.has(one.file)) {
            // A file named in the exclusion rather than a directory. An entry point that starts a
            // run of its own is the case this exists for: calling it is calling the whole tool
            // again, and no answer about the code comes back from that.
            skipped.push({ file: one.file, because: "it was named in the exclusion" });
            continue;
        }
        if (isSimFile(one.file)) {
            sims.set(one.file, one.full);
            continue;
        }
        if (isDeclarationFile(one.file)) {
            skipped.push({ file: one.file, because: "it declares types and holds no code to run" });
            continue;
        }
        if (isTestFile(one.file)) {
            skipped.push({ file: one.file, because: "it is a test of its own, so it is a harness rather than code to exercise" });
            continue;
        }
        sources.push(one);
    }

    for (const one of sources) {
        const wanted = simFileFor(one.file);
        if (sims.has(wanted)) {
            one.sim = sims.get(wanted);
        }
    }

    return { sources, sims, skipped };
}

// A path written the one way, so a report reads the same on every machine.
export function toPosix(file: string): string {
    return file.split(path.sep).join("/");
}
