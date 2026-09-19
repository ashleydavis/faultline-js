// Scenarios for reading the functions, classes, factories, scenarios and invariants out of a file.
//
// What the reader finds turns on the syntax and the types it is given, and no made up value is
// either. These build a program over source held in memory and read it.

import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import { readFile, type FileFacts } from "./functions.ts";
import type { RecipeContext } from "./recipes.ts";

// Where the runtime module is declared for these, so a parameter of one of its types is told from a
// type that merely carries the same name.
const runtimeFile = "/node_modules/faultline/index.ts";

// What that module declares, which is the whole of what a project imports.
const runtime = `
export type EffectName = "net" | "files" | "writer" | "clock" | "rng" | "calls" | "values" | "process";
export interface Injector { fail(effect: EffectName, failure: string): void; failures(effect: EffectName): string[]; clear(): void }
export interface Checklist { ticked(name: string): boolean; names(): string[] }
`;

// Reads one file the way a run reads it, with the standard library served through the compiler's
// own file access because a run measuring this repository replaces `node:fs` with a tree of its own.
function read(text: string, file = "/held.ts"): FileFacts {
    const held: Record<string, string> = { [file]: text, [runtimeFile]: runtime };
    const host: ts.CompilerHost = {
        getSourceFile: (asked, language) => {
            const own = held[asked];
            if (own !== undefined) {
                return ts.createSourceFile(asked, own, language, true);
            }
            const lib = ts.sys.readFile(asked);
            return lib === undefined ? undefined : ts.createSourceFile(asked, lib, language, true);
        },
        getDefaultLibFileName: (asked) => ts.getDefaultLibFilePath(asked),
        writeFile: () => undefined,
        getCurrentDirectory: () => "/",
        getCanonicalFileName: (asked) => asked,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
        fileExists: (asked) => held[asked] !== undefined || ts.sys.fileExists(asked),
        readFile: (asked) => held[asked] ?? ts.sys.readFile(asked),
    };
    const program = ts.createProgram(Object.keys(held), { strict: true, target: ts.ScriptTarget.ES2022 }, host);
    const context: RecipeContext = { checker: program.getTypeChecker(), runtimeFile: [runtimeFile], root: "/" };
    return readFile(context, program.getSourceFile(file)!, file.slice(1));
}

// Every way a function can be written and every way one is reached.
export function everyWayAFunctionIsReached(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = read(`
export function exported(a: string): string { return a; }
function kept(a: string): string { return a; }
export { kept as underAnotherName };
function hidden(): number { return 1; }
export const arrow = (a: number): number => a;
export const anonymous = function (): number { return 1; };
const alsoKept = (): number => 1;
export default function theDefault(): number { return 1; }
export async function waits(): Promise<string> { return "a"; }
export function* yields(): Generator<number> { yield 1; }
export class Shown {
    private held = 0;
    constructor(at: number) { this.held = at; }
    method(a: string): string { return a; }
    static onTheClass(): number { return 1; }
    get read(): number { return this.held; }
    set read(at: number) { this.held = at; }
    private kept(): number { return 1; }
}
class NotShown {
    method(): number { return 1; }
}
export function usesThem(): number { return hidden() + alsoKept() + new NotShown().method(); }
export function nested(): () => number {
    function inside(): number { return 1; }
    return inside;
}
`);
    const ways = new Set(found.functions.map((one) => one.reach.how));
    for (const wanted of ["export", "method", "inside"]) {
        if (!ways.has(wanted as "export")) {
            throw new Error(`TheReaderFoundNothingReachedBy_${wanted}`);
        }
    }
    if (found.classes.length < 2) {
        throw new Error("TheReaderMissedAClass");
    }
    if (!found.functions.some((one) => one.async)) {
        throw new Error("TheReaderSaidNothingHandsBackAPromise");
    }
    if (!found.functions.some((one) => one.within !== undefined)) {
        throw new Error("TheReaderSaidNothingIsWrittenInsideAnother");
    }
}

// A sim file, which is where a test input factory, a scenario and an invariant are found.
export function whatASimFileHolds(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = read(`
import type { Checklist, Injector } from "/node_modules/faultline/index.ts";
export interface Held { name: string }
export class Made { held(): Held { return { name: "a" }; } }
export function aFactory(): Held { return { name: "a" }; }
export function alsoAFactory(at: number): Held { return { name: String(at) }; }
export function aScenario(one: Injector, two: Checklist): void { void one; void two; }
export function anInvariant(): void { return; }
export function neitherOfThose(a: string): string { return a; }
`, "/held.sim.ts");
    if (found.factories.length === 0) {
        throw new Error("TheReaderFoundNoTestInputFactory");
    }
    if (found.scenarios.length !== 1) {
        throw new Error("TheReaderFoundTheWrongNumberOfScenarios");
    }
    if (found.invariants.length !== 1) {
        throw new Error("TheReaderFoundTheWrongNumberOfInvariants");
    }
}

// A file with nothing in it, and one whose functions take the run's own types.
export function theQuietCases(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    read("");
    read("export const held = 1;\nexport type Named = string;\nexport interface Also { a: string }\n");
    read('import type { Injector } from "/node_modules/faultline/index.ts";\nexport function f(one: Injector): void { void one; }');
    read("export function f(one: AbortSignal): void { void one; }");
    read("export class A { constructor() { void 0; } }\nexport class B extends A { }\n");
}
