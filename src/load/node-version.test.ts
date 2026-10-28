//
// Tests the check that refuses to start Faultline on a runtime that cannot run it. The goal is that
// Node at the version Faultline names runs and any other runtime gets one sentence saying why not.
//
// The method is to give the check the versions a runtime reports and the range Faultline's
// `package.json` names, and read the sentence it answers with, or to read a `package.json` held in
// a file system in memory, so no test touches the disk.
//

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "@jest/globals";
import { createFakeFileSystem } from "../lib/fake-files.test.ts";
import { isOlder, isWholeVersion, minimumVersion, nodeVersionRefusal, parseVersion, readRequiredNode, writeVersion } from "./node-version.ts";
import type { IRuntimeVersions } from "./node-version.ts";

//
// The directory the `package.json` files these tests read sit in, in memory.
//
const faultlineDirectory = "/faultline";

//
// The `package.json` files the tests read, in memory, by name.
//
const files = createFakeFileSystem({
    [path.join(faultlineDirectory, "package.json")]: "{ \"engines\": { \"node\": \">=24.0.0\" } }\n",
    [path.join(faultlineDirectory, "good.json")]: "{ \"engines\": { \"node\": \">=24.0.0\" } }\n",
    [path.join(faultlineDirectory, "none.json")]: "{}\n",
    [path.join(faultlineDirectory, "empty.json")]: "{ \"engines\": {} }\n",
    [path.join(faultlineDirectory, "number.json")]: "{ \"engines\": { \"node\": 24 } }\n",
    [path.join(faultlineDirectory, "list.json")]: "[]\n",
});

//
// The path of one of the `package.json` files above.
//
export function packageFile(name: string): string {
    return path.join(faultlineDirectory, name);
}

//
// What Node at version `node` reports about itself.
//
export function nodeAt(node: string): IRuntimeVersions {
    return {
        node,
        bun: undefined,
    };
}

describe("nodeVersionRefusal", () => {
    test("Node at or above the minimum runs", () => {
        for (const node of ["24.0.0", "24.0.1", "24.22.0", "25.0.0", "v30.1.2"]) {
            assert.equal(nodeVersionRefusal(nodeAt(node), ">=24.0.0"), undefined);
        }
    });

    test("an older Node is refused in one sentence that names both versions", () => {
        const refusal = nodeVersionRefusal(nodeAt("22.22.2"), ">=24.0.0");
        assert.equal(refusal, "Faultline needs Node 24.0.0 or later and this is Node 22.22.2, so install Node 24 or later and run it again.");
        assert.equal(nodeVersionRefusal(nodeAt("24.1.9"), ">=24.2.0")?.includes("Node 24.1.9"), true);
    });

    test("Bun is refused whatever Node version it reports", () => {
        const refusal = nodeVersionRefusal({
            node: "24.3.0",
            bun: "1.4.3",
        }, ">=24.0.0");
        assert.equal(refusal, "Faultline needs Node 24.0.0 or later and this is Bun 1.4.3, so start `flt` with Node.");
    });

    test("the range Faultline's package.json names lets a newer Node run and refuses an older one", async () => {
        const required = await readRequiredNode(files, packageFile("package.json"));
        assert.equal(nodeVersionRefusal(nodeAt("99.0.0"), required), undefined);
        assert.notEqual(nodeVersionRefusal(nodeAt("18.0.0"), required), undefined);
    });

    test("an empty range or an empty Node version is refused", () => {
        assert.throws(() => nodeVersionRefusal(nodeAt("24.0.0"), ""), assert.AssertionError);
        assert.throws(() => nodeVersionRefusal(nodeAt(""), ">=24.0.0"), assert.AssertionError);
    });
});

describe("readRequiredNode", () => {
    test("engines.node is read", async () => {
        assert.equal(await readRequiredNode(files, packageFile("good.json")), ">=24.0.0");
    });

    test("a package.json that cannot be read fails with the reading's own error", async () => {
        files.failNext(packageFile("good.json"), "EACCES");
        await assert.rejects(readRequiredNode(files, packageFile("good.json")), {
            code: "EACCES",
        });
    });

    test("a package.json without engines.node is a broken install", async () => {
        await assert.rejects(readRequiredNode(files, packageFile("none.json")), assert.AssertionError);
        await assert.rejects(readRequiredNode(files, packageFile("empty.json")), assert.AssertionError);
        await assert.rejects(readRequiredNode(files, packageFile("number.json")), assert.AssertionError);
        await assert.rejects(readRequiredNode(files, packageFile("list.json")), assert.AssertionError);
    });
});

describe("minimumVersion", () => {
    test("a >= range gives its version", () => {
        assert.deepEqual(minimumVersion(">=24.1.2"), {
            major: 24,
            minor: 1,
            patch: 2,
        });
    });

    test("any other range is a mistake in Faultline", () => {
        assert.throws(() => minimumVersion("^24.0.0"), /not written as >=/);
        assert.throws(() => minimumVersion("24.0.0"), /not written as >=/);
    });
});

describe("parseVersion", () => {
    test("three numbers are read with or without a v", () => {
        assert.deepEqual(parseVersion("v24.22.0"), {
            major: 24,
            minor: 22,
            patch: 0,
        });
        assert.deepEqual(parseVersion("1.4.3"), {
            major: 1,
            minor: 4,
            patch: 3,
        });
    });

    test("anything else is refused", () => {
        for (const text of ["24", "24.1", "v24.1.0-pre", "", "x.y.z"]) {
            assert.throws(() => parseVersion(text), /not a version/);
        }
    });
});

describe("isOlder", () => {
    test("each number decides only when the ones before it are equal", () => {
        const minimum = parseVersion("24.2.3");
        assert.equal(isOlder(parseVersion("23.9.9"), minimum), true);
        assert.equal(isOlder(parseVersion("25.0.0"), minimum), false);
        assert.equal(isOlder(parseVersion("24.1.9"), minimum), true);
        assert.equal(isOlder(parseVersion("24.3.0"), minimum), false);
        assert.equal(isOlder(parseVersion("24.2.2"), minimum), true);
        assert.equal(isOlder(parseVersion("24.2.3"), minimum), false);
        assert.equal(isOlder(parseVersion("24.2.4"), minimum), false);
    });
});

describe("isWholeVersion", () => {
    test("three whole numbers that are not negative are a whole version", () => {
        assert.equal(isWholeVersion(parseVersion("0.0.0")), true);
        assert.equal(isWholeVersion(parseVersion("24.2.3")), true);
    });

    test("a number that is not whole, too large to be exact or negative is not", () => {
        const whole = parseVersion("24.2.3");
        for (const broken of [
            {
                ...whole,
                major: 1.5,
            },
            {
                ...whole,
                minor: Number.MAX_SAFE_INTEGER + 1,
            },
            {
                ...whole,
                patch: Number.NaN,
            },
            {
                ...whole,
                major: -1,
            },
            {
                ...whole,
                minor: -1,
            },
            {
                ...whole,
                patch: -1,
            },
        ]) {
            assert.equal(isWholeVersion(broken), false, JSON.stringify(broken));
        }
    });

    test("a version that is not whole is refused where versions are compared or written", () => {
        const broken = {
            ...parseVersion("24.2.3"),
            patch: -1,
        };
        assert.throws(() => isOlder(broken, parseVersion("24.2.3")), assert.AssertionError);
        assert.throws(() => isOlder(parseVersion("24.2.3"), broken), assert.AssertionError);
        assert.throws(() => writeVersion(broken), assert.AssertionError);
    });
});

describe("writeVersion", () => {
    test("a version is written without the v", () => {
        assert.equal(writeVersion(parseVersion("v24.0.1")), "24.0.1");
        assert.equal(writeVersion(parseVersion("0.10.200")), "0.10.200");
    });
});
