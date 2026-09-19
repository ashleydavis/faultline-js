// Scenarios for what the report calls a function and whether a file exports it.
//
// What these answer turns on the syntax they are given, and no made up value is a piece of syntax.

import ts from "typescript";
import type { Checklist, Injector } from "faultline";
import { functionLabel, isFunctionNode, isReportedFunction } from "./names.ts";

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
const inAnObject = { held: (): number => 1, "quoted name": (): number => 1, 7: (): number => 1 };
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

// What is a function and what merely looks like one, and which of them the report names at all.
export function whatCountsAsAFunction(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    labels("export interface Held { method(): number }\nexport type Also = () => number;\ndeclare function held(): number;\nvoid held;");
    labels("export abstract class A { abstract method(): number; }");
    labels("export class A { declare held: number; }");
    labels("");
}
