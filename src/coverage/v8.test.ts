import assert from "node:assert/strict";
import test from "node:test";
import { addInto, countAcross, countAt, inlineMapOf, mergeInto, Offsets, Places, type ScriptCoverage, type Taken } from "./v8.ts";

// One script written the way V8 reports it, with the ranges given outermost first.
function script(url: string, ranges: [number, number, number][]): ScriptCoverage {
    return { url, functions: [{ functionName: "", ranges: ranges.map(([startOffset, endOffset, count]) => ({ startOffset, endOffset, count })) }] };
}

test("the count at an offset is the count of the narrowest range covering it", () => {
    const held = script("file:///a.js", [[0, 100, 5], [40, 60, 2]]);
    assert.equal(countAt(held, 10), 5);
    assert.equal(countAt(held, 45), 2);
});

test("an offset no range covers sits in a function that never ran", () => {
    assert.equal(countAt(script("file:///a.js", [[0, 10, 3]]), 50), 0);
});

test("the first reading of a script is kept as it came", () => {
    const total = new Map<string, ScriptCoverage>();
    addInto(total, [script("file:///a.js", [[0, 100, 5], [40, 60, 2]])]);
    assert.equal(countAt(total.get("file:///a.js")!, 45), 2);
    assert.equal(countAt(total.get("file:///a.js")!, 10), 5);
});

test("two readings of the same range are added", () => {
    const total = new Map<string, ScriptCoverage>();
    addInto(total, [script("file:///a.js", [[0, 100, 5]])]);
    addInto(total, [script("file:///a.js", [[0, 100, 3]])]);
    assert.equal(countAt(total.get("file:///a.js")!, 10), 8);
});

test("a block V8 left out of the second reading takes the count of the block around it", () => {
    // V8 reports no range for a block whose count matches the block around it. Reading the missing
    // range as nothing would say the block ran twice when it ran five times.
    const total = new Map<string, ScriptCoverage>();
    addInto(total, [script("file:///a.js", [[0, 100, 4], [40, 60, 2]])]);
    addInto(total, [script("file:///a.js", [[0, 100, 3]])]);
    assert.equal(countAt(total.get("file:///a.js")!, 45), 5);
    assert.equal(countAt(total.get("file:///a.js")!, 10), 7);
});

test("a block only the second reading names takes the count of the block around it in the first", () => {
    const total = new Map<string, ScriptCoverage>();
    addInto(total, [script("file:///a.js", [[0, 100, 4]])]);
    addInto(total, [script("file:///a.js", [[0, 100, 3], [40, 60, 1]])]);
    assert.equal(countAt(total.get("file:///a.js")!, 45), 5);
});

test("a block neither reading entered stays at nothing", () => {
    const total = new Map<string, ScriptCoverage>();
    addInto(total, [script("file:///a.js", [[0, 100, 4], [40, 60, 0]])]);
    addInto(total, [script("file:///a.js", [[0, 100, 3], [40, 60, 0]])]);
    assert.equal(countAt(total.get("file:///a.js")!, 45), 0);
});

test("a run adds up what every process counted", () => {
    const held: Taken = new Map();
    mergeInto(held, 1, [script("file:///a.js", [[0, 100, 2]])]);
    mergeInto(held, 2, [script("file:///a.js", [[0, 100, 3]])]);
    assert.equal(countAcross(held, "file:///a.js", 10), 5);
});

test("the newest word from one process replaces what it said before", () => {
    const held: Taken = new Map();
    mergeInto(held, 1, [script("file:///a.js", [[0, 100, 2]])]);
    mergeInto(held, 1, [script("file:///a.js", [[0, 100, 9]])]);
    assert.equal(countAcross(held, "file:///a.js", 10), 9);
});

test("a script no process loaded ran no times", () => {
    assert.equal(countAcross(new Map(), "file:///a.js", 0), 0);
});

test("an offset counts the characters of every line before it", () => {
    const offsets = new Offsets("ab\ncd\nef");
    assert.equal(offsets.offsetOf(1, 0), 0);
    assert.equal(offsets.offsetOf(2, 1), 4);
    assert.equal(offsets.offsetOf(3, 0), 6);
});

test("a line the file does not have is nowhere", () => {
    assert.equal(new Offsets("ab").offsetOf(9, 0), -1);
});

test("a map inside the file is read out of the end of it", () => {
    const text = `x\n//# sourceMappingURL=data:application/json;base64,${Buffer.from('{"k":1}').toString("base64")}\n`;
    assert.equal(inlineMapOf(text), '{"k":1}');
});

test("a file carrying no map has none to read", () => {
    assert.equal(inlineMapOf("x\n"), undefined);
});

test("a position in the source is found in the file that ran", () => {
    // Two mappings: the start of the source is the start of the generated file, and line 2 column
    // 0 of the source is line 1 column 4 of it.
    const map = JSON.stringify({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,IACA" });
    const places = new Places(map, "0123456789\n");
    assert.equal(places.generatedOffsetOf(2, 0), 4);
});

test("a position the transpile left nowhere is answered with nothing", () => {
    const map = JSON.stringify({ version: 3, sources: ["a.ts"], names: [], mappings: "" });
    assert.equal(new Places(map, "x\n").generatedOffsetOf(5, 0), -1);
});

test("a wide range counting nothing does not hide what an earlier reading counted", () => {
    // The tail of a function that did not run in the second reading comes back as one range
    // counting nothing, and that one range covers blocks the first reading counted separately.
    const total = new Map<string, ScriptCoverage>();
    addInto(total, [script("file:///a.js", [[0, 100, 21], [40, 60, 0], [70, 80, 0]])]);
    addInto(total, [script("file:///a.js", [[0, 100, 3], [40, 100, 0]])]);
    // The block at 60 to 70 ran under the first reading, and the second reading says nothing
    // about it beyond the wide range it sits inside.
    assert.equal(countAt(total.get("file:///a.js")!, 65), 21);
    assert.equal(countAt(total.get("file:///a.js")!, 45), 0);
});

test("the total is a row of pieces that do not overlap", () => {
    const total = new Map<string, ScriptCoverage>();
    addInto(total, [script("file:///a.js", [[0, 100, 5], [40, 60, 2]])]);
    addInto(total, [script("file:///a.js", [[0, 100, 3], [20, 80, 1]])]);
    const ranges = [...total.get("file:///a.js")!.functions[0]!.ranges].sort((left, right) => left.startOffset - right.startOffset);
    for (let at = 0; at + 1 < ranges.length; at += 1) {
        assert.equal(ranges[at]!.endOffset, ranges[at + 1]!.startOffset);
    }
});
