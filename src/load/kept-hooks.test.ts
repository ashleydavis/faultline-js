//
// Checks the in-thread hooks that keep the loader thread's answers: an import is asked of the next
// hook once per importer file, specifier and kind of importer, and every later copy gets the kept
// answer under its own copy number; a copy of a project file is loaded once and every later copy
// gets the kept source; anything else goes to the next hook every time. The next hooks are
// stand-ins that count how often they are asked.
//

import assert from "node:assert/strict";
import type module from "node:module";
import { describe, test } from "@jest/globals";
import { createKeptAnswers, keptLoad, keptResolve, registerKeptHooks, resolutionKey, type IKeptAnswers } from "./kept-hooks.ts";

//
// A resolve context for an import written in the module at `parentURL`.
//
export function resolveContext(parentURL: string | undefined): module.ResolveHookContext {
    return {
        conditions: ["node", "import"],
        importAttributes: {},
        parentURL,
    };
}

//
// A load context for a module.
//
export const loadContext: module.LoadHookContext = {
    conditions: ["node", "import"],
    format: undefined,
    importAttributes: {},
};

//
// A next resolve hook that answers every import with `url` and writes down each question.
//
export function recordingNextResolve(url: string, asked: string[]): (specifier: string) => module.ResolveFnOutput {
    return (specifier: string): module.ResolveFnOutput => {
        asked.push(specifier);
        return {
            url,
            shortCircuit: true,
        };
    };
}

//
// Kept answers with nothing kept yet, which send `http` and `node:http` to a simulated module in
// the tool's directory `/faultline/src`.
//
export function emptyKept(): IKeptAnswers {
    return createKeptAnswers(new Map([
        ["http", "/faultline/src/world/effects/http.js"],
        ["node:http", "/faultline/src/world/effects/http.js"],
    ]), "/faultline/src");
}

describe("built-in modules", () => {
    test("a built-in module Faultline simulates is the simulated one for a package's require, a project file and the entry point", () => {
        const asked: string[] = [];
        const next = recordingNextResolve("node:http", asked);
        const simulated = "file:///faultline/src/world/effects/http.js";
        assert.equal(keptResolve(emptyKept(), "http", resolveContext("file:///p/node_modules/sdk/dist-cjs/index.js"), next).url, simulated);
        assert.equal(keptResolve(emptyKept(), "node:http", resolveContext("file:///p/src/a.ts?flt=2"), next).url, simulated);
        assert.equal(keptResolve(emptyKept(), "http", resolveContext(undefined), next).url, simulated);
        assert.deepEqual(asked, []);
    });

    test("the tool's own modules, and a built-in module Faultline does not simulate, get Node's answer", () => {
        const asked: string[] = [];
        const next = recordingNextResolve("node:http", asked);
        assert.equal(keptResolve(emptyKept(), "http", resolveContext("file:///faultline/src/world/network.js"), next).url, "node:http");
        assert.equal(keptResolve(emptyKept(), "node:path", resolveContext("file:///p/src/a.ts"), next).url, "node:http");
        assert.deepEqual(asked, ["http", "node:path"]);
    });

    test("a relative tool directory is refused", () => {
        assert.throws(() => createKeptAnswers(new Map(), "faultline/src"), assert.AssertionError);
    });
});

describe("resolutionKey", () => {
    test("an import from a copy and from the file itself are kept apart, and the copy number is left out", () => {
        const fromCopy = resolutionKey("./b", resolveContext("file:///p/src/a.ts?flt=3"));
        assert.equal(fromCopy, resolutionKey("./b", resolveContext("file:///p/src/a.ts?flt=9")));
        assert.notEqual(fromCopy, resolutionKey("./b", resolveContext("file:///p/src/a.ts")));
        assert.notEqual(fromCopy, resolutionKey("./c", resolveContext("file:///p/src/a.ts?flt=3")));
    });

    test("an import with no importer file has no key", () => {
        assert.equal(resolutionKey("./b", resolveContext(undefined)), undefined);
        assert.equal(resolutionKey("./b", resolveContext("node:internal")), undefined);
    });
});

describe("keptResolve", () => {
    test("a copy's import is asked once, and later copies get the same file under their own number", () => {
        const kept = emptyKept();
        const asked: string[] = [];
        const next = recordingNextResolve("file:///p/src/b.ts?flt=1", asked);
        assert.equal(keptResolve(kept, "./b", resolveContext("file:///p/src/a.ts?flt=1"), next).url, "file:///p/src/b.ts?flt=1");
        const later = keptResolve(kept, "./b", resolveContext("file:///p/src/a.ts?flt=2"), next);
        assert.equal(later.url, "file:///p/src/b.ts?flt=2");
        assert.equal(later.shortCircuit, true);
        assert.deepEqual(asked, ["./b"]);
    });

    test("an answer that is no copy is kept as it is", () => {
        const kept = emptyKept();
        const asked: string[] = [];
        const next = recordingNextResolve("file:///tool/world/effects/fs.js", asked);
        keptResolve(kept, "node:fs", resolveContext("file:///p/src/a.ts?flt=1"), next);
        assert.equal(keptResolve(kept, "node:fs", resolveContext("file:///p/src/a.ts?flt=2"), next).url, "file:///tool/world/effects/fs.js");
        assert.deepEqual(asked, ["node:fs"]);
    });

    test("a copy imported by its URL is asked once, and later copies are given their own URL", () => {
        const kept = emptyKept();
        const asked: string[] = [];
        const next = (specifier: string): module.ResolveFnOutput => {
            asked.push(specifier);
            return {
                url: specifier,
                format: "module",
                shortCircuit: true,
            };
        };
        keptResolve(kept, "file:///p/src/a.ts?flt=1", resolveContext("file:///tool/run/child.js"), next);
        const later = keptResolve(kept, "file:///p/src/a.ts?flt=2&fresh=5", resolveContext("file:///tool/run/child.js"), next);
        assert.equal(later.url, "file:///p/src/a.ts?flt=2&fresh=5");
        assert.equal(later.format, "module");
        assert.deepEqual(asked, ["file:///p/src/a.ts?flt=1"]);
    });

    test("a URL the loader thread sends somewhere else is asked every time", () => {
        const kept = emptyKept();
        const asked: string[] = [];
        const next = recordingNextResolve("file:///elsewhere/a.js", asked);
        keptResolve(kept, "file:///p/src/a.ts?flt=1", resolveContext("file:///tool/run/child.js"), next);
        keptResolve(kept, "file:///p/src/a.ts?flt=2", resolveContext("file:///tool/run/child.js"), next);
        assert.equal(asked.length, 2);
        assert.equal(kept.resolveAnswers.size, 0);
    });

    test("an import with no importer file is asked every time", () => {
        const kept = emptyKept();
        const asked: string[] = [];
        const next = recordingNextResolve("file:///p/src/main.ts", asked);
        keptResolve(kept, "./main", resolveContext(undefined), next);
        keptResolve(kept, "./main", resolveContext(undefined), next);
        assert.deepEqual(asked, ["./main", "./main"]);
        assert.equal(kept.resolveAnswers.size, 0);
    });
});

describe("keptLoad", () => {
    test("a copy of a project file is loaded once, and later copies get the kept source", () => {
        const kept = emptyKept();
        const asked: string[] = [];
        const next = (url: string): module.LoadFnOutput => {
            asked.push(url);
            return {
                format: "module",
                source: "export const a = 1;",
                shortCircuit: true,
            };
        };
        keptLoad(kept, "file:///p/src/a.ts?flt=1", loadContext, next);
        const later = keptLoad(kept, "file:///p/src/a.ts?flt=2", loadContext, next);
        assert.equal(later.source, "export const a = 1;");
        assert.equal(later.format, "module");
        assert.deepEqual(asked, ["file:///p/src/a.ts?flt=1"]);
    });

    test("a URL that is no copy is loaded by the next hook every time", () => {
        const kept = emptyKept();
        const asked: string[] = [];
        const next = (url: string): module.LoadFnOutput => {
            asked.push(url);
            return {
                format: "module",
                source: "",
                shortCircuit: true,
            };
        };
        keptLoad(kept, "file:///p/src/a.ts", loadContext, next);
        keptLoad(kept, "file:///p/src/a.ts", loadContext, next);
        assert.equal(asked.length, 2);
        assert.equal(kept.loadAnswers.size, 0);
    });

    test("a copy the loader thread gives no source for is a defect", () => {
        const next = (): module.LoadFnOutput => ({
            format: "builtin",
            shortCircuit: true,
        });
        assert.throws(() => keptLoad(emptyKept(), "file:///p/src/a.ts?flt=1", loadContext, next), /with no source/);
    });
});

describe("registerKeptHooks", () => {
    test("the hooks registered answer from the kept answers", () => {
        const kept = emptyKept();
        const registered: module.RegisterHooksOptions[] = [];
        const handle: module.ModuleHooks = {
            deregister: (): void => {
                registered.length = 0;
            },
        };
        assert.equal(registerKeptHooks(kept, (options: module.RegisterHooksOptions): module.ModuleHooks => {
            registered.push(options);
            return handle;
        }), handle);
        const options = registered[0];
        assert(options !== undefined);
        assert(options.resolve !== undefined);
        assert(options.load !== undefined);
        const asked: string[] = [];
        options.resolve("./b", resolveContext("file:///p/src/a.ts?flt=1"), recordingNextResolve("file:///p/src/b.ts?flt=1", asked));
        assert.equal(kept.resolveAnswers.size, 1);
        options.load("file:///p/src/b.ts?flt=1", loadContext, (): module.LoadFnOutput => ({
            format: "module",
            source: "",
            shortCircuit: true,
        }));
        assert.equal(kept.loadAnswers.size, 1);
    });
});
