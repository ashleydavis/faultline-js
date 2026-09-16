import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { optionsFor } from "../build/program.ts";
import { driverDirectory, emitDriver, pageDriver, serve } from "./browser.ts";

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

test("the server hands back a copy as JavaScript, so a browser will run it", async () => {
    const work = scratch();
    fs.writeFileSync(path.join(work, "a.mjs"), "export const a = 1;\n");
    const served = await serve(work);
    const answer = await fetch(`http://127.0.0.1:${served.port}/a.mjs`);
    assert.equal(answer.headers.get("content-type"), "text/javascript");
    assert.equal(await answer.text(), "export const a = 1;\n");
    served.close();
    fs.rmSync(work, { recursive: true, force: true });
});

test("the server hands back a page at the root, so a run has somewhere to load into", async () => {
    const work = scratch();
    const served = await serve(work);
    const answer = await fetch(`http://127.0.0.1:${served.port}/`);
    assert.match(answer.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await answer.text(), /<!doctype html>/);
    served.close();
    fs.rmSync(work, { recursive: true, force: true });
});

test("a file the work directory does not have comes back as missing", async () => {
    const work = scratch();
    const served = await serve(work);
    assert.equal((await fetch(`http://127.0.0.1:${served.port}/gone.mjs`)).status, 404);
    served.close();
    fs.rmSync(work, { recursive: true, force: true });
});

test("a path that climbs out of the work directory is refused", async () => {
    const work = scratch();
    const served = await serve(work);
    const answer = await fetch(`http://127.0.0.1:${served.port}/..%2F..%2Fetc%2Fpasswd`);
    assert.equal(answer.status, 403);
    served.close();
    fs.rmSync(work, { recursive: true, force: true });
});

test("the model a run wrote is served, because the page reads it rather than being handed it", async () => {
    const work = scratch();
    fs.writeFileSync(path.join(work, "model.json"), '{"seeds":[1]}');
    const served = await serve(work);
    const answer = await fetch(`http://127.0.0.1:${served.port}/model.json`);
    assert.equal(answer.headers.get("content-type"), "application/json");
    assert.deepEqual(await answer.json(), { seeds: [1] });
    served.close();
    fs.rmSync(work, { recursive: true, force: true });
});
