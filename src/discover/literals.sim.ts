// Scenarios for reading the values a file's own code tests against.
//
// What it finds turns on the syntax it is given, and no made up value is a piece of syntax.

import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import { literalsIn, valueOf } from "./literals.ts";

// Reads one piece of source with a checker over it, which is what resolves a name standing for one
// value. The standard library is read through the compiler's own file access, because a run
// measuring this repository replaces `node:fs` with a tree of its own.
function read(text: string): ReturnType<typeof literalsIn> {
    const name = "/held.ts";
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
    const host: ts.CompilerHost = {
        getSourceFile: (asked, language) => {
            if (asked === name) {
                return source;
            }
            const held = ts.sys.readFile(asked);
            return held === undefined ? undefined : ts.createSourceFile(asked, held, language, true);
        },
        getDefaultLibFileName: (asked) => ts.getDefaultLibFilePath(asked),
        writeFile: () => undefined,
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (asked) => asked,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (asked) => asked === name || ts.sys.fileExists(asked),
        readFile: (asked) => (asked === name ? text : ts.sys.readFile(asked)),
    };
    const program = ts.createProgram([name], { strict: true, target: ts.ScriptTarget.ES2022 }, host);
    return literalsIn(program.getTypeChecker(), program.getSourceFile(name)!);
}

// Every way a file says what it turns on.
export function everyWayAFileSaysWhatItTurnsOn(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = read(`
const enum Flag { On = 8, Off = 16 }
const named = "settled";
export function f(a: string, b: number, c: { held: string }, d: string[]): number {
    if (a === "the-one-word") { return 1; }
    if (a !== named) { return 2; }
    if (b > 42 && b < 99) { return 3; }
    if (b >= 7 || b <= -7) { return 4; }
    if ((b & Flag.On) !== 0) { return 5; }
    if ((b | Flag.Off) === 0) { return 6; }
    if ("held" in c && c.held === "there") { return 7; }
    if (a.startsWith("PNG")) { return 8; }
    if (d.includes("kept")) { return 9; }
    if (a.split("-").length === 2) { return 10; }
    if (a.replace("x", "y") === "z") { return 11; }
    // A \`new\` written with no brackets at all, which carries no argument list to read.
    void new Date;
    if (d[3] === "at") { return 12; }
    switch (a) {
        case "red": return 13;
        case "blue": return 14;
        default: break;
    }
    const made = new Map([["k", 1]]);
    return made.size;
}
`);
    for (const wanted of ["the-one-word", "settled", "PNG", "kept", "-", "red", "blue"]) {
        if (!found.values.includes(wanted)) {
            throw new Error(`TheReaderMissedTheString_${wanted}`);
        }
    }
    for (const wanted of [42, 99, 7, -7, 8, 16, 2, 3]) {
        if (!found.values.includes(wanted)) {
            throw new Error(`TheReaderMissedTheNumber_${String(wanted)}`);
        }
    }
    if (!found.properties.includes("held")) {
        throw new Error("TheReaderMissedThePropertyTheFileReads");
    }
}

// A file that tests against nothing hands over nothing, and one expression at a time.
export function aFileThatTestsAgainstNothing(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = read("export function f(a: number): number { return a; }");
    if (found.values.length !== 0) {
        throw new Error("TheReaderFoundValuesInAFileThatNamesNone");
    }
    const name = "/held.ts";
    const source = ts.createSourceFile(name, "const a = true; const b = 1; const c = 'x'; const d: unknown = {};", ts.ScriptTarget.Latest, true);
    const program = ts.createProgram([name], {}, {
        getSourceFile: (asked) => (asked === name ? source : undefined),
        getDefaultLibFileName: () => "lib.d.ts",
        writeFile: () => undefined,
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (asked) => asked,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (asked) => asked === name,
        readFile: (asked) => (asked === name ? "" : undefined),
    });
    const checker = program.getTypeChecker();
    const walk = (node: ts.Node): void => {
        valueOf(checker, node);
        ts.forEachChild(node, walk);
    };
    walk(program.getSourceFile(name)!);
}
