//
// Checks where Faultline keeps its files in a project: under `node_modules/.cache/faultline/`, and
// only for an absolute project path, so a relative one never lands in whatever directory the
// process happens to be in.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { cacheDirectoryOf } from "./cache-directory.ts";

describe("cacheDirectoryOf", () => {
    test("the cache directory sits under node_modules in the project", () => {
        assert.equal(cacheDirectoryOf("/work/project"), "/work/project/node_modules/.cache/faultline");
    });

    test("a relative project path is a defect in the caller", () => {
        assert.throws(() => cacheDirectoryOf("project"));
    });
});
