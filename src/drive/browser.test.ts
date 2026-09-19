import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { optionsFor } from "../build/program.ts";
import { driverDirectory, emitDriver, pageDriver, serveOne } from "./browser.ts";

// A directory of its own for one test.
function scratch(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "faultline-browser-"));
}

// Where this repository is, so the driver is emitted from the real source.
const here = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

test("the driver is written into the work directory as modules a browser can load", () => {
    const work = scratch();
    emitDriver(work, optionsFor(here));
    assert.ok(fs.existsSync(path.join(work, pageDriver)));
    fs.rmSync(work, { recursive: true, force: true });
});

test("everything the driver imports is written out beside it", () => {
    const work = scratch();
    emitDriver(work, optionsFor(here));
    const written = fs
        .readdirSync(path.join(work, driverDirectory), { recursive: true })
        .map((one) => String(one))
        .filter((one) => one.endsWith(".mjs"));
    for (const wanted of ["drive/work.mjs", "drive/values.mjs", "effects/subject.mjs", "effects/injector.mjs"]) {
        assert.ok(written.includes(wanted), `${wanted} was not written`);
    }
    fs.rmSync(work, { recursive: true, force: true });
});

test("the driver names no TypeScript file, because a browser loads none", () => {
    const work = scratch();
    emitDriver(work, optionsFor(here));
    const text = fs.readFileSync(path.join(work, pageDriver), "utf8");
    assert.equal(/from\s+["']\.[^"']*\.ts["']/.test(text), false);
    fs.rmSync(work, { recursive: true, force: true });
});

test("the driver reaches for nothing only Node has", () => {
    const work = scratch();
    emitDriver(work, optionsFor(here));
    for (const one of fs.readdirSync(path.join(work, driverDirectory), { recursive: true }).map((x) => String(x))) {
        if (!one.endsWith(".mjs")) {
            continue;
        }
        const text = fs.readFileSync(path.join(work, driverDirectory, one), "utf8");
        assert.equal(text.includes('from "node:'), false, `${one} imports a Node module`);
    }
    fs.rmSync(work, { recursive: true, force: true });
});

test("the answer to a copy is JavaScript, so a browser will run it", () => {
    const work = scratch();
    fs.writeFileSync(path.join(work, "a.mjs"), "export const a = 1;\n");
    const answer = serveOne(work, "/a.mjs");
    assert.equal(answer.type, "text/javascript");
    assert.equal(String(answer.body), "export const a = 1;\n");
    fs.rmSync(work, { recursive: true, force: true });
});

test("the answer at the root is a page, so a run has somewhere to load into", () => {
    const work = scratch();
    const answer = serveOne(work, "/");
    assert.match(answer.type ?? "", /text\/html/);
    assert.match(String(answer.body), /<!doctype html>/);
    fs.rmSync(work, { recursive: true, force: true });
});

test("a file the work directory does not have comes back as missing", () => {
    const work = scratch();
    assert.equal(serveOne(work, "/gone.mjs").status, 404);
    fs.rmSync(work, { recursive: true, force: true });
});

test("a path that climbs out of the work directory is refused", () => {
    const work = scratch();
    assert.equal(serveOne(work, "/..%2F..%2Fetc%2Fpasswd").status, 403);
    fs.rmSync(work, { recursive: true, force: true });
});

test("the model a run wrote is answered with, because the page reads it rather than being handed it", () => {
    const work = scratch();
    fs.writeFileSync(path.join(work, "model.json"), '{"seeds":[1]}');
    const answer = serveOne(work, "/model.json");
    assert.equal(answer.type, "application/json");
    assert.deepEqual(JSON.parse(String(answer.body)) as unknown, { seeds: [1] });
    fs.rmSync(work, { recursive: true, force: true });
});
