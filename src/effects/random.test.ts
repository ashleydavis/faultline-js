import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng } from "./random.ts";

test("the same seed draws the same numbers", () => {
    const first = new SeededRng(7);
    const second = new SeededRng(7);
    for (let index = 0; index < 100; index += 1) {
        assert.equal(first.next(), second.next());
    }
});

test("a different seed draws different numbers", () => {
    assert.notEqual(new SeededRng(1).next(), new SeededRng(2).next());
});

test("every draw sits from zero up to but not including one", () => {
    const rng = new SeededRng(3);
    for (let index = 0; index < 1000; index += 1) {
        const drawn = rng.next();
        assert.ok(drawn >= 0 && drawn < 1, `drew ${drawn}`);
    }
});

test("a seed outside thirty two bits is folded into them", () => {
    assert.equal(new SeededRng(-1).position, new SeededRng(4294967295).position);
});

test("the position moves with every draw", () => {
    const rng = new SeededRng(5);
    const before = rng.position;
    rng.next();
    assert.notEqual(rng.position, before);
});

test("an integer lands inside the range it was asked for", () => {
    const rng = new SeededRng(11);
    for (let index = 0; index < 500; index += 1) {
        const drawn = rng.int(3, 6);
        assert.ok(drawn >= 3 && drawn <= 6, `drew ${drawn}`);
        assert.ok(Number.isInteger(drawn));
    }
});

test("a range written backwards gives its low end", () => {
    assert.equal(new SeededRng(1).int(9, 2), 9);
});

test("a range of one number gives that number", () => {
    assert.equal(new SeededRng(1).int(4, 4), 4);
});

test("picking takes one of the items", () => {
    const rng = new SeededRng(13);
    const items = ["a", "b", "c"];
    for (let index = 0; index < 100; index += 1) {
        assert.ok(items.includes(rng.pick(items)));
    }
});

test("picking from an empty list says so", () => {
    assert.throws(() => new SeededRng(1).pick([]), /empty/);
});

test("bytes come back in the count asked for and inside a byte", () => {
    const drawn = new SeededRng(17).bytes(64);
    assert.equal(drawn.length, 64);
    for (const byte of drawn) {
        assert.ok(byte >= 0 && byte <= 255);
    }
});

test("no bytes are asked for and none come back", () => {
    assert.equal(new SeededRng(1).bytes(0).length, 0);
});

test("an identifier reads as a version four one", () => {
    const made = new SeededRng(19).uuid();
    assert.match(made, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("two identifiers from one generator differ", () => {
    const rng = new SeededRng(23);
    assert.notEqual(rng.uuid(), rng.uuid());
});
