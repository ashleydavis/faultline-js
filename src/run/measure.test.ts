//
// Checks that one reading of V8's coverage becomes the code paths it exercised in every project
// file that ran. A small project is held in a file system in memory and its file is run in this
// process the way the module hooks load it, once as itself and once as a fresh copy with a query on
// its URL, with precise coverage on, so the readings are V8's own.
//

import assert from "node:assert/strict";
import { Session } from "node:inspector/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { describe, test } from "@jest/globals";
import { startCoverage, takeCoverage } from "../coverage/v8.ts";
import { createFakeFileSystem } from "../lib/fake-files.test.ts";
import { createLoader, loadedText } from "../load/hooks.ts";
import { createMeasurer, exercisedKeys, fileOfPathKey, isMeasurable, measureUrl, pathKey, withoutQuery } from "./measure.ts";

//
// The root of the project the tests measure. Any absolute path does, because the file system in
// memory holds nothing else.
//
const root = "/project";

//
// The loader over that project, reading it from memory.
//
const loader = createLoader({
    projectRoot: root,
    toolModules: "/faultline/src",
}, createFakeFileSystem({
    [path.join(root, "package.json")]: "{ \"name\": \"project\", \"type\": \"commonjs\" }\n",
    [path.join(root, "src", "pick.ts")]: "export function pick(value: number): string {\n    if (value > 0) {\n        return \"plus\";\n    }\n    return \"minus\";\n}\n",
    [path.join(root, "src", "pick.sim.ts")]: "export const one = 1;\n",
}));

//
// Runs the project file at `url` in this process as the hooks would load it, and hands back its
// `pick`.
//
export async function pickAt(url: string): Promise<(value: number) => string> {
    const file = path.join(root, "src", "pick.ts");
    const loaded = await loadedText(loader, file);
    const exports: Record<string, (value: number) => string> = {};
    vm.runInNewContext(loaded, {
        exports,
    }, {
        filename: url,
    });
    const pick = exports["pick"];
    assert(pick);
    return pick;
}

describe("exercisedKeys", () => {
    test("a reading gives the paths each call exercised, a fresh copy counting as its file", async () => {
        const session = new Session();
        session.connect();
        try {
            await startCoverage(session);
            const url = pathToFileURL(path.join(root, "src", "pick.ts")).href;
            const measurer = createMeasurer(loader);
            const first = await pickAt(url);
            assert.deepEqual(await exercisedKeys(await takeCoverage(session), measurer), [pathKey("src/pick.ts", "(top level):entered")]);
            first(1);
            assert.deepEqual(await exercisedKeys(await takeCoverage(session), measurer), [
                pathKey("src/pick.ts", "if:2:true"),
                pathKey("src/pick.ts", "pick:entered"),
            ]);
            const copy = await pickAt(`${url}?flt=1`);
            copy(0);
            assert.deepEqual(await exercisedKeys(await takeCoverage(session), measurer), [
                pathKey("src/pick.ts", "(top level):entered"),
                pathKey("src/pick.ts", "if:2:false"),
                pathKey("src/pick.ts", "pick:entered"),
            ]);
        }
        finally {
            session.disconnect();
        }
    });

    test("a script that is no project source file adds nothing", async () => {
        const measurer = createMeasurer(loader);
        const reading = [{
            url: "node:internal/timers",
            functions: [],
        }];
        assert.deepEqual(await exercisedKeys(reading, measurer), []);
    });

    test("code made at run time, which has no URL, adds nothing and is never measured", async () => {
        const measured: string[] = [];
        const measurer = {
            measure: (url: string): Promise<undefined> => {
                measured.push(url);
                return Promise.resolve(undefined);
            },
        };
        const reading = [{
            url: "",
            functions: [],
        }, {
            url: "node:internal/timers",
            functions: [],
        }];
        assert.deepEqual(await exercisedKeys(reading, measurer), []);
        assert.deepEqual(measured, ["node:internal/timers"]);
    });

    test("a reading with code made by new Function beside a project file gives the file's paths", async () => {
        const session = new Session();
        session.connect();
        try {
            await startCoverage(session);
            const url = pathToFileURL(path.join(root, "src", "pick.ts")).href;
            const measurer = createMeasurer(loader);
            const pick = await pickAt(`${url}?flt=2`);
            const made = new Function("value", "return value + 1;");
            assert.equal(made(1), 2);
            pick(1);
            const reading = await takeCoverage(session);
            assert.ok(reading.some((script) => script.url === ""));
            assert.deepEqual(await exercisedKeys(reading, measurer), [
                pathKey("src/pick.ts", "(top level):entered"),
                pathKey("src/pick.ts", "if:2:true"),
                pathKey("src/pick.ts", "pick:entered"),
            ]);
        }
        finally {
            session.disconnect();
        }
    });
});

describe("createMeasurer", () => {
    test("a file is measured once and kept, and a URL naming no source file gives nothing", async () => {
        const measurer = createMeasurer(loader);
        const url = pathToFileURL(path.join(root, "src", "pick.ts")).href;
        const measured = await measurer.measure(url);
        assert.equal(await measurer.measure(url), measured);
        assert.deepEqual(measured?.paths.map((measuredPath) => measuredPath.path.name), ["(top level):entered", "pick:entered", "if:2:true", "if:2:false"]);
        assert.equal(await measurer.measure("node:fs"), undefined);
        assert.equal(await measurer.measure("node:fs"), undefined);
    });
});

describe("measureUrl", () => {
    test("a sim file and a URL that names no file give nothing", async () => {
        assert.equal(await measureUrl(loader, pathToFileURL(path.join(root, "src", "pick.sim.ts")).href), undefined);
        assert.equal(await measureUrl(loader, "node:fs"), undefined);
    });

    test("a file the hooks have not loaded is transpiled once and kept, as the hooks would load it", async () => {
        const fresh = createLoader({
            projectRoot: root,
            toolModules: "/faultline/src",
        }, createFakeFileSystem({
            [path.join(root, "package.json")]: "{ \"name\": \"project\", \"type\": \"commonjs\" }\n",
            [path.join(root, "src", "pick.ts")]: "export function pick(value: number): string {\n    return value > 0 ? \"plus\" : \"minus\";\n}\n",
        }));
        const file = path.join(root, "src", "pick.ts");
        assert.equal(fresh.transpiled.has(file), false);
        const measured = await measureUrl(fresh, pathToFileURL(file).href);
        assert.ok(measured);
        const kept = fresh.transpiled.get(file);
        assert.ok(kept);
        assert.equal(await loadedText(fresh, file), kept);
    });

    test("a file the hooks have loaded is measured in the text they kept", async () => {
        const file = path.join(root, "src", "pick.ts");
        const kept = await loadedText(loader, file);
        const measured = await measureUrl(loader, pathToFileURL(file).href);
        assert.ok(measured);
        assert.equal(loader.transpiled.get(file), kept);
    });
});

describe("isMeasurable", () => {
    test("only the project's own source files count", () => {
        assert.equal(isMeasurable(root, path.join(root, "src", "a.ts")), true);
        assert.equal(isMeasurable(root, path.join(root, "src", "a.md")), false);
        assert.equal(isMeasurable(root, path.join(root, "src", "a.sim.ts")), false);
        assert.equal(isMeasurable(root, path.join(root, "src", "a.test.ts")), false);
        assert.equal(isMeasurable(root, path.join(root, "src", "a.d.ts")), false);
        assert.equal(isMeasurable(root, path.join(root, "node_modules", "lib", "a.js")), false);
    });

});

describe("pathKey", () => {
    test("a key joins a file and a path's name with a tab", () => {
        assert.equal(pathKey("src/a.ts", "f:entered"), "src/a.ts\tf:entered");
        assert.throws(() => pathKey("src/a\t.ts", "f:entered"));
    });
});

describe("fileOfPathKey", () => {
    test("the file is what comes before the tab, and text with no file before a tab is no key", () => {
        assert.equal(fileOfPathKey(pathKey("src/a.ts", "f:entered")), "src/a.ts");
        assert.throws(() => fileOfPathKey("no tab"), /no tab is not the key of a code path\./);
        assert.throws(() => fileOfPathKey("\tf:entered"));
    });
});

describe("withoutQuery", () => {
    test("a fresh copy's URL loses its query, and a URL with none is left as it is", () => {
        assert.equal(withoutQuery("file:///a.ts?flt=3"), "file:///a.ts");
        assert.equal(withoutQuery("file:///a.ts"), "file:///a.ts");
    });
});
