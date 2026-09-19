// Scenarios for reading the code paths out of a file.
//
// What a path reader does turns on the syntax it is given, and no made up value builds a piece of
// syntax. These hand it source text of every kind it has something to say about.

import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import { pathsIn } from "./paths.ts";

// Reads one piece of source the way a run reads a file.
function read(text: string): ReturnType<typeof pathsIn> {
    return pathsIn(ts.createSourceFile("a.ts", text, ts.ScriptTarget.Latest, true), "a.ts");
}

// Every branch a file can hold, read in one go.
export function everyKindOfBranch(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = read(`
export function every(a: number, b: string | undefined, c: { d?: () => number }): number {
    if (a > 1) {
        a += 1;
    }
    else {
        a -= 1;
    }
    if (a > 2) {
        a += 1;
    }
    const held = a > 3 ? 1 : 2;
    const one = b ?? "none";
    const two = b !== undefined && b.length > 0;
    const three = b !== undefined || a > 0;
    switch (one) {
        case "a":
            a += 1;
            break;
        case "b":
        case "c":
            a += 2;
            break;
        default:
            a += 3;
    }
    for (const piece of one) {
        a += piece.length;
    }
    for (let at = 0; at < 2; at += 1) {
        a += at;
    }
    while (a < 0) {
        a += 1;
    }
    do {
        a += 1;
    } while (a < 0);
    try {
        a += 1;
    }
    catch {
        a -= 1;
    }
    const four = c?.d?.();
    const five = c?.["d"];
    void held; void two; void three; void four; void five;
    return a;
}

export class Held {
    private kept = 0;

    constructor(at: number) {
        this.kept = at;
    }

    get held(): number {
        return this.kept;
    }

    set held(at: number) {
        this.kept = at;
    }

    static made(): Held {
        return new Held(1);
    }

    inside(): number {
        const one = (): number => {
            if (this.kept > 0) {
                return 1;
            }
            return 0;
        };
        return one();
    }
}

export const arrow = (a: number): number => (a > 0 ? 1 : 0);
export default function alsoThis(): number {
    return 1;
}
`);
    if (found.paths.length < 30) {
        throw new Error(`TheReaderFoundTooFewPaths: ${String(found.paths.length)}`);
    }
    for (const wanted of ["if:", "ternary:", "logic:", "case:", "loop:", "catch:", "chain:"]) {
        if (!found.paths.some((one) => one.name.startsWith(wanted))) {
            throw new Error(`TheReaderFoundNo_${wanted}`);
        }
    }
}

// A condition a loop tests every turn, which V8 reports no count for, so the reader says so rather
// than reporting it unreached on every run.
export function whatTheCounterCannotSee(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = read(`
export function f(a: string | undefined, b: { c?: string } | undefined): number {
    let n = 0;
    while (a !== undefined && a.length > 0) {
        n += 1;
        break;
    }
    for (let at = 0; at < 2 && a !== undefined; at += 1) {
        n += at;
    }
    do {
        n += 1;
    } while (a !== undefined || n < 0);
    while (b?.c !== undefined) {
        break;
    }
    return n;
}
`);
    if (found.unseen.length < 3) {
        throw new Error(`TheReaderSaidTooLittleWasLeftOut: ${String(found.unseen.length)}`);
    }
}

// Every way a body is written, because where a path begins is read from the body and a body is not
// always a block.
export function everyKindOfBody(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    read("export function f(a: number) { if (a > 0) return 1; else return 2; }");
    read("export function f(a: number) { for (const x of [1]) if (x > a) break; }");
    read("export function f(a: number) { while (a > 0) a -= 1; }");
    read("export function f() { try { throw new Error('x'); } catch (thrown) { void thrown; } finally { void 0; } }");
    read("export function f(a: number) { switch (a) { case 1: default: break; } }");
    read("export function f(a: number) { switch (a) { case 1: } return a; }");
    read("export const f = function () { return 1; };");
    read("export const f = async function* () { yield 1; };");
    read("export function f() { return (() => 1)(); }");

    // A body with no statement in it, which has no statement to point at.
    read("export function f() {}");
    read("export function f(a = 1) { void a; }");

    // A declaration with no body, which is the signature of a function written more than one way.
    read("export function f(a: number): number;\nexport function f(a: string): string;\nexport function f(a: unknown) { return a; }");

    // A branch inside a loop rather than in what the loop turns on, which is counted where a
    // branch in the condition is not.
    read("export function f(a: number) { while (a > 0) { if (a > 5) { a -= 1; } } }");
    read("export function f(a: number) { do { if (a > 5) { a -= 1; } } while (a > 0); }");
    read("export function f(n: number) { for (let i = 0; i < n; i += 1) { if (i > 2) { break; } } }");
    read("export function f(n: number) { for (let i = 0; i < n; i += (i > 1 ? 2 : 1)) { void i; } }");

    // A short circuit inside a loop's body rather than in what the loop turns on, which is counted
    // where one in the condition is not.
    read("export function f(a: number, b?: string) { while (a > 0) { const c = b ?? 'x'; void c; a -= 1; } }");
    read("export function f(a: number, b?: string) { do { const c = b ?? 'x'; void c; a -= 1; } while (a > 0); }");
    read("export function f(n: number, b?: string) { for (let i = 0; i < n; i += 1) { const c = b ?? 'x'; void c; } }");

    // A short circuit in what a `for` moves on by each turn, which runs as often as the condition
    // and is counted the same way.
    read("export function f(n: number, b?: number) { for (let i = 0; i < n; i += (b ?? 1)) { void i; } }");
    read("export class A { }");
    read("");
}
