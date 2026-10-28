//
// Tests the checklist. Goal: every code path no call exercised becomes one item carrying its file
// and line, a function no call can reach becomes one item for the whole function (a value factory
// for the type no value is built for, or a scenario for a function Faultline cannot call), items
// come in kind order, the terminal gets at most ten under a heading that counts them and the report
// file gets every one. Method: build shard results written out in each test and read the items and
// lines made from them.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import type { IShardResult } from "../run/explore.ts";
import type { IFunctionPlan, IPathRecord } from "../run/messages.ts";
import { checkedItem, checklistFileLines, checklistItems, checklistLines, headingOf, pathItem, sentenceOf, shardItems, shortLineOf, terminalLimit, type IChecklistItem } from "./checklist.ts";

//
// A code path of the function `at.fn` in `src/a.ts`, named `at.name`, on `line`.
//
export function pathRecord(at: { fn: string; name: string }, line: number): IPathRecord {
    return {
        key: `src/a.ts\t${at.name}`,
        file: "src/a.ts",
        line,
        fn: at.fn,
        describe: `the path ${at.name}`,
    };
}

//
// A function of `src/a.ts` called `named.label` on `line`, with what stops it being called, if
// anything: `named.uncallable` says why Faultline cannot call it and `named.unbuildable` names the
// type no value is built for.
//
export function functionOf(named: { label: string; uncallable: string | undefined; unbuildable: string | undefined }, line: number): IFunctionPlan {
    return {
        label: named.label,
        name: named.label,
        line,
        uncallable: named.uncallable,
        unbuildable: named.unbuildable,
        choices: [],
        targets: [],
    };
}

//
// The result of a shard of `file` with `functions` and `paths`.
//
export function shardOf(file: string, functions: IFunctionPlan[], paths: IPathRecord[]): IShardResult {
    return {
        facts: {
            file,
            functions,
            scenarios: [],
            paths,
            notProvable: [],
            uncallable: [],
            simProblems: [],
            loadProblem: undefined,
        },
        tallies: [],
        exercised: [],
        failures: [],
        failedCalls: [],
    };
}

//
// An item asking for a scenario that reaches the code path `name` on `line`.
//
export function scenarioItem(name: string, line: number): IChecklistItem {
    return pathItem(pathRecord({
        fn: "f",
        name,
    }, line));
}

describe("checklistItems", () => {
    test("each code path no call exercised is one item, with its file, line and function", () => {
        const shard = shardOf("src/a.ts", [functionOf({
            label: "f",
            uncallable: undefined,
            unbuildable: undefined,
        }, 1)], [pathRecord({
            fn: "f",
            name: "f:entered",
        }, 1), pathRecord({
            fn: "f",
            name: "if:2:true",
        }, 2)]);
        const items = checklistItems([shard], new Set(["src/a.ts\tf:entered"]));
        assert.deepEqual(items, [{
            kind: "scenario",
            file: "src/a.ts",
            line: 2,
            fn: "f",
            describe: "the path if:2:true",
            typeName: "",
            because: "",
        }]);
    });

    test("a function whose parameter no value is built for is one value factory item for the whole function", () => {
        const shard = shardOf("src/a.ts", [functionOf({
            label: "f",
            uncallable: undefined,
            unbuildable: "Store",
        }, 3)], [pathRecord({
            fn: "f",
            name: "f:entered",
        }, 3), pathRecord({
            fn: "f",
            name: "if:4:true",
        }, 4)]);
        const items = checklistItems([shard], new Set());
        assert.equal(items.length, 1);
        assert.equal(items[0]!.kind, "value-factory");
        assert.equal(items[0]!.typeName, "Store");
        assert.equal(items[0]!.line, 3);
    });

    test("a function Faultline cannot call is one scenario item for the whole function, from the plan or from discovery", () => {
        const fromPlan = shardOf("src/a.ts", [functionOf({
            label: "g",
            uncallable: "it is written inside another function",
            unbuildable: undefined,
        }, 5)], [pathRecord({
            fn: "g",
            name: "g:entered",
        }, 5)]);
        const fromDiscovery = shardOf("src/a.ts", [], [pathRecord({
            fn: "h",
            name: "h:entered",
        }, 9)]);
        fromDiscovery.facts.uncallable.push({
            label: "h",
            line: 9,
            because: "its class is abstract",
        }, {
            label: "done",
            line: 12,
            because: "its class is abstract",
        });
        const items = checklistItems([fromPlan, fromDiscovery], new Set());
        assert.deepEqual(items.map((one) => [one.kind, one.fn, one.because]), [
            ["uncallable", "g", "it is written inside another function"],
            ["uncallable", "h", "its class is abstract"],
        ]);
    });

    test("a function listed both by its plan and by discovery is one item", () => {
        const shard = shardOf("src/a.ts", [functionOf({
            label: "g",
            uncallable: "it is written inside another function",
            unbuildable: undefined,
        }, 5)], [pathRecord({
            fn: "g",
            name: "g:entered",
        }, 5)]);
        shard.facts.uncallable.push({
            label: "g",
            line: 5,
            because: "it is written inside another function",
        });
        assert.equal(checklistItems([shard], new Set()).length, 1);
    });

    test("a function whose code paths were all exercised needs nothing, whatever stops it being called", () => {
        const shard = shardOf("src/a.ts", [functionOf({
            label: "g",
            uncallable: "its file failed to load",
            unbuildable: undefined,
        }, 5), functionOf({
            label: "k",
            uncallable: undefined,
            unbuildable: "Store",
        }, 7)], [pathRecord({
            fn: "g",
            name: "g:entered",
        }, 5), pathRecord({
            fn: "k",
            name: "k:entered",
        }, 7)]);
        assert.deepEqual(checklistItems([shard], new Set(["src/a.ts\tg:entered", "src/a.ts\tk:entered"])), []);
    });

    test("items come value factories first, then uncallable functions, then code paths", () => {
        const shard = shardOf("src/a.ts", [
            functionOf({
            label: "f",
            uncallable: undefined,
            unbuildable: undefined,
        }, 1),
            functionOf({
            label: "g",
            uncallable: "it is written inside another function",
            unbuildable: undefined,
        }, 5),
            functionOf({
            label: "k",
            uncallable: undefined,
            unbuildable: "Store",
        }, 7),
        ], [pathRecord({
            fn: "f",
            name: "if:2:true",
        }, 2), pathRecord({
            fn: "g",
            name: "g:entered",
        }, 5), pathRecord({
            fn: "k",
            name: "k:entered",
        }, 7)]);
        assert.deepEqual(checklistItems([shard], new Set()).map((one) => one.kind), ["value-factory", "uncallable", "scenario"]);
    });

    test("a sim file's shard gives no items", () => {
        const shard = shardOf("src/a.sim.ts", [], [pathRecord({
            fn: "f",
            name: "f:entered",
        }, 1)]);
        assert.deepEqual(checklistItems([shard], new Set()), []);
    });
});

describe("shardItems", () => {
    test("a shard with every path exercised gives no items", () => {
        const shard = shardOf("src/a.ts", [functionOf({
            label: "f",
            uncallable: undefined,
            unbuildable: undefined,
        }, 1)], [pathRecord({
            fn: "f",
            name: "f:entered",
        }, 1)]);
        assert.deepEqual(shardItems(shard, new Set(["src/a.ts\tf:entered"])), []);
    });
});

describe("checkedItem", () => {
    test("an item at no line is a mistake in whoever made it", () => {
        assert.throws(() => checkedItem({
            ...scenarioItem("x", 1),
            line: 0,
        }), assert.AssertionError);
        assert.throws(() => checkedItem({
            ...scenarioItem("x", 1),
            file: "",
        }), assert.AssertionError);
    });
});

describe("sentenceOf", () => {
    test("each kind says what to write and where", () => {
        assert.equal(sentenceOf(scenarioItem("if:2:true", 2)), "Write a value factory that reaches the path if:2:true at src/a.ts:2 in f, or a scenario that exercises it if no value factory can.");
        assert.equal(sentenceOf({
            ...scenarioItem("x", 3),
            kind: "value-factory",
            typeName: "Store",
        }), "Write a value factory returning Store, which f takes. Without one, f at src/a.ts:3 cannot be called at all.");
        assert.equal(sentenceOf({
            ...scenarioItem("x", 5),
            kind: "uncallable",
            because: "it is written inside another function",
        }), "Write a scenario that calls f at src/a.ts:5. Faultline cannot call it itself, because it is written inside another function.");
    });
});

describe("headingOf and shortLineOf", () => {
    test("each kind has a heading said once and a short line per item", () => {
        assert.match(headingOf("value-factory"), /^Each of these types needs a value factory/);
        assert.match(headingOf("uncallable"), /^Each of these functions needs a scenario/);
        assert.match(headingOf("scenario"), /^Each of these code paths needs a value factory/);
        assert.equal(shortLineOf(scenarioItem("if:2:true", 2)), "the path if:2:true at src/a.ts:2 in f");
        assert.equal(shortLineOf({
            ...scenarioItem("x", 3),
            kind: "value-factory",
            typeName: "Store",
        }), "Store, for f at src/a.ts:3");
        assert.equal(shortLineOf({
            ...scenarioItem("x", 5),
            kind: "uncallable",
            because: "its file failed to load",
        }), "f at src/a.ts:5, because its file failed to load");
    });
});

describe("checklistLines", () => {
    test("no items prints nothing", () => {
        assert.deepEqual(checklistLines([]), []);
    });

    test("one item is its sentence under a heading that counts it in words", () => {
        const item = scenarioItem("if:2:true", 2);
        assert.deepEqual(checklistLines([item]), ["", "  One thing to do:", `    ${sentenceOf(item)}`]);
    });

    test("several items of a kind are said once over a short line each", () => {
        const items = [scenarioItem("a", 2), scenarioItem("b", 3)];
        assert.deepEqual(checklistLines(items), [
            "",
            "  Two things to do:",
            `    ${headingOf("scenario")}`,
            "      the path a at src/a.ts:2 in f",
            "      the path b at src/a.ts:3 in f",
        ]);
    });

    test("the terminal gets at most ten items and a line saying how many more there are", () => {
        const items: IChecklistItem[] = [];
        for (let line = 1; line <= terminalLimit + 3; line += 1) {
            items.push(scenarioItem(`p${line}`, line));
        }
        const lines = checklistLines(items);
        assert.equal(lines[1], "  13 things to do:");
        assert.equal(lines.filter((line) => line.startsWith("      ")).length, terminalLimit);
        assert.equal(lines[lines.length - 1], "    and 3 more.");
    });

    test("the limit counts across kinds, so a later kind gets what is left", () => {
        const items: IChecklistItem[] = [];
        for (let line = 1; line <= terminalLimit - 1; line += 1) {
            items.push({
                ...scenarioItem("x", line),
                kind: "value-factory",
                typeName: `T${line}`,
            });
        }
        items.push(scenarioItem("a", 20), scenarioItem("b", 21));
        const lines = checklistLines(items);
        assert(lines.includes(`    ${sentenceOf(scenarioItem("a", 20))}`));
        assert.equal(lines[lines.length - 1], "    and 1 more.");
    });
});

describe("checklistFileLines", () => {
    test("the report file gets every item as a to do line", () => {
        const items = [scenarioItem("a", 2), scenarioItem("b", 3)];
        assert.deepEqual(checklistFileLines(items), items.map((one) => `to do ${sentenceOf(one)}`));
    });
});
