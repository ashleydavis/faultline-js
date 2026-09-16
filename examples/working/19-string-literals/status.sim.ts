// One scenario reaching every word at once, which is what a run cannot make up.

import type { Checklist, Injector, Subject } from "faultline";
import { meaningOf } from "./status.ts";

export function everyWordItKnows(self: Subject, injector: Injector, checklist: Checklist): void {
    void self;
    void injector;
    void checklist;

    const wanted: [string, string][] = [
        ["ok", "everything is fine"],
        ["warn", "something may go wrong"],
        ["fail", "something went wrong"],
    ];
    for (const [word, meaning] of wanted) {
        if (meaningOf(word) !== meaning) {
            throw new Error(`TheWordMeantSomethingElse: ${word}`);
        }
    }
}
