//
// Tests for the replacement of `node:inspector`.
//
// The goal is to show that code under test that opens the inspector gets a session connected to
// no inspector: it is refused while not connected as the real one refuses, it counts no coverage,
// it hears no event and it opens no port. The method is to make each call on the replacement and
// read what its callback was given. The lookup of the replacement runs over a file system in
// memory.
//

import assert from "node:assert/strict";
import path from "node:path";
import { describe, test } from "@jest/globals";
import { createFakeFileSystem } from "../../lib/fake-files.test.ts";
import inspector, { Session } from "./inspector.ts";
import { effectModuleFor } from "./index.ts";

//
// The directory the replacements sit in, in memory, holding the inspector's.
//
const directory = path.join(path.parse(process.cwd()).root, "faultline", "src", "world", "effects");

describe("effectModuleFor", () => {
    test("every spelling of the inspector names the same replacement", async () => {
        const files = createFakeFileSystem({
            [path.join(directory, "inspector.ts")]: "",
        });
        const found = await effectModuleFor(files, "inspector", directory);
        assert.equal(found, path.join(directory, "inspector.ts"));
        assert.equal(await effectModuleFor(files, "node:inspector", directory), found);
        assert.equal(await effectModuleFor(files, "node:inspector/promises", directory), found);
        assert.equal(await effectModuleFor(files, "inspector/promises", directory), found);
    });
});

describe("Session", () => {
    test("a post before the session is connected is refused the way the real one refuses it", () => {
        const session = new Session();
        let said: Error | null | undefined;
        session.post("Profiler.enable", (error) => {
            said = error;
        });
        assert.ok(said instanceof Error);
    });

    test("a post with no answer asked for is taken and says nothing", () => {
        const session = new Session();
        session.connect();
        assert.doesNotThrow(() => {
            session.post("Profiler.enable");
        });
    });

    test("a session connected to no inspector counted no coverage", () => {
        const session = new Session();
        session.connect();
        let taken: unknown;
        session.post("Profiler.takePreciseCoverage", (error, result) => {
            assert.equal(error, null);
            taken = result;
        });
        assert.deepEqual(taken, {
            result: [],
        });
    });

    test("every other post is answered with an empty result", () => {
        const session = new Session();
        session.connect();
        let taken: unknown = "not answered";
        session.post("Profiler.startPreciseCoverage", {
            callCount: true,
        }, (error, result) => {
            assert.equal(error, null);
            taken = result;
        });
        assert.deepEqual(taken, {});
    });

    test("a post after the session is disconnected is refused again", () => {
        const session = new Session();
        session.connect();
        session.disconnect();
        let said: Error | null | undefined;
        session.post("Profiler.enable", (error) => {
            said = error;
        });
        assert.ok(said instanceof Error);
    });

    test("a session opened from a worker is open", () => {
        const session = new Session();
        session.connectToMainThread();
        //
        // Undefined until the callback runs, so a callback that never runs fails the check below.
        //
        let said: Error | null | undefined = undefined;
        session.post("Profiler.enable", (error) => {
            said = error;
        });
        assert.equal(said, null);
    });

    test("an event a caller listens for never arrives", () => {
        const session = new Session();
        session.connect();
        let heard = 0;
        session.on("Profiler.consoleProfileFinished", () => {
            heard += 1;
        });
        session.post("Profiler.enable");
        assert.equal(heard, 0);
    });
});

describe("the inspector itself", () => {
    test("opening the inspector on a port opens no port, and it is reached on no address", () => {
        assert.doesNotThrow(() => {
            inspector.open();
            inspector.waitForDebugger();
            inspector.close();
        });
        assert.equal(inspector.url(), undefined);
    });

    test("the console a caller writes to is the ordinary one", () => {
        assert.equal(inspector.console, globalThis.console);
    });
});
