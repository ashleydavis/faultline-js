// Scenarios for what the report calls a function and whether a file exports it.
//
// What these answer turns on the syntax they are given, and no made up value is a piece of syntax.

import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import { functionLabel, isExported, isFunctionNode, isReportedFunction } from "./names.ts";

// Every function in one piece of source, with what the report calls it.
function labels(text: string): string[] {
    const source = ts.createSourceFile("/held.ts", text, ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const walk = (node: ts.Node): void => {
        if (isFunctionNode(node)) {
            isReportedFunction(node);
            out.push(functionLabel(node));
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    return out;
}

// Every way a function can be named.
export function everyWayAFunctionIsNamed(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const found = labels(`
export function named(): number { return 1; }
export default function (): number { return 1; }
export const arrow = (): number => 1;
export const assigned = function (): number { return 1; };
export const { destructured = (): number => 1 } = {};
const inAList = [(): number => 1];
const inAnObject = { held(): number { return 1; }, "quoted name"(): number { return 1; }, 7(): number { return 1; }, get read(): number { return 1; } };
({ loose(): number { return 1; } });
export class Held {
    constructor() { void 0; }
    method(): number { return 1; }
    static onTheClass(): number { return 1; }
    get read(): number { return 1; }
    set read(at: number) { void at; }
    "quoted method"(): number { return 1; }
    [Symbol.iterator](): number { return 1; }
    held = (): number => 1;
}
export const anonymousClass = class { method(): number { return 1; } };
export function* yields(): Generator<number> { yield 1; }
export async function waits(): Promise<number> { return 1; }
void inAList; void inAnObject; void anonymousClass;
`);
    for (const wanted of ["named", "arrow", "assigned", "Held.method", "Held.onTheClass", "Held.read", "Held.constructor"]) {
        if (!found.includes(wanted)) {
            throw new Error(`TheReportWouldNotCallAnything_${wanted}`);
        }
    }
    if (!found.includes("(anonymous)")) {
        throw new Error("TheReportNamedSomethingThatHasNoName");
    }
}

// Whether a declaration is reachable from outside the file it is written in.
export function whetherADeclarationIsReachable(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const source = ts.createSourceFile(
        "/held.ts",
        `
export function shown(): number { return 1; }
function kept(): number { return 1; }
export const alsoShown = 1;
const alsoKept = 1;
export class Held { method(): number { return 1; } }
class NotHeld { method(): number { return 1; } }
export default class { }
`,
        ts.ScriptTarget.Latest,
        true,
    );
    let anyExported = false;
    let anyKept = false;
    const walk = (node: ts.Node): void => {
        if (isExported(node)) {
            anyExported = true;
        }
        else {
            anyKept = true;
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    if (!anyExported) {
        throw new Error("NothingInTheFileWasReadAsExported");
    }
    if (!anyKept) {
        throw new Error("EverythingInTheFileWasReadAsExported");
    }
}

// What is a function and what merely looks like one, and which of them the report names at all.
export function whatCountsAsAFunction(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    labels("export interface Held { method(): number }\nexport type Also = () => number;\ndeclare function held(): number;\nvoid held;");
    labels("export abstract class A { abstract method(): number; }");
    labels("export class A { declare held: number; }");
    labels("");
}
