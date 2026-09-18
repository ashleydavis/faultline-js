import assert from "node:assert/strict";
import test from "node:test";
import { runWith } from "../current.ts";
import { RunSubject } from "../subject.ts";
import files from "./fs.ts";

// Runs `work` with one run in flight, so the replaced file system answers from that run's tree. It
// waits for work that is not finished when it returns, or the run would be taken away first.
async function whileRunning<T>(work: () => T | Promise<T>): Promise<T> {
    const before = runWith(new RunSubject(7, "clean"));
    try {
        return await work();
    }
    finally {
        runWith(before);
    }
}

test("a file the run starts with is read from the tree rather than the disk", async () => {
    const text = await whileRunning(() => files.readFileSync("/settings.json", "utf8"));
    assert.equal(JSON.parse(text as string).retries, 3);
});

test("a read with no encoding asked for comes back as bytes", async () => {
    const held = await whileRunning(() => files.readFileSync("/notes.txt"));
    assert.ok(held instanceof Buffer);
});

test("a file that is not there fails the way the runtime fails", async () => {
    await whileRunning(async () => {
        assert.throws(() => files.readFileSync("/missing.txt", "utf8"), (thrown: { code?: string }) => thrown.code === "ENOENT");
    });
});

test("what a run writes is what it reads back", async () => {
    await whileRunning(async () => {
        files.writeFileSync("/a/b/held.txt", "kept");
        assert.equal(files.readFileSync("/a/b/held.txt", "utf8"), "kept");
    });
});

test("a write makes the directories above the file", async () => {
    await whileRunning(async () => {
        files.writeFileSync("/a/b/held.txt", "kept");
        assert.deepEqual(files.readdirSync("/a"), ["b"]);
        assert.ok(files.existsSync("/a/b"));
    });
});

test("an append adds to the end of what was there", async () => {
    await whileRunning(async () => {
        files.writeFileSync("/log.txt", "one\n");
        files.appendFileSync("/log.txt", "two\n");
        assert.equal(files.readFileSync("/log.txt", "utf8"), "one\ntwo\n");
    });
});

test("a file taken away is no longer there", async () => {
    await whileRunning(async () => {
        files.unlinkSync("/notes.txt");
        assert.equal(files.existsSync("/notes.txt"), false);
    });
});

test("taking away a file that is not there fails the way the runtime fails", async () => {
    await whileRunning(async () => {
        assert.throws(() => files.unlinkSync("/missing.txt"), (thrown: { code?: string }) => thrown.code === "ENOENT");
    });
});

test("a stat says whether the path is a file or a directory", async () => {
    await whileRunning(async () => {
        files.mkdirSync("/somewhere");
        assert.equal(files.statSync("/settings.json").isFile(), true);
        assert.equal(files.statSync("/somewhere").isDirectory(), true);
    });
});

test("a renamed file keeps what was in it and leaves its old path empty", async () => {
    await whileRunning(async () => {
        files.renameSync("/notes.txt", "/moved.txt");
        assert.equal(files.readFileSync("/moved.txt", "utf8").toString().startsWith("The first line."), true);
        assert.equal(files.existsSync("/notes.txt"), false);
    });
});

test("a copied file is at both paths", async () => {
    await whileRunning(async () => {
        files.copyFileSync("/notes.txt", "/copy.txt");
        assert.equal(files.existsSync("/notes.txt"), true);
        assert.equal(files.existsSync("/copy.txt"), true);
    });
});

test("a read through a callback hands the answer to the callback", async () => {
    const text = await whileRunning(
        async () =>
            new Promise<string>((settle, refuse) => {
                files.readFile("/settings.json", "utf8", (error: unknown, held: unknown) => {
                    if (error !== null) {
                        refuse(error as Error);
                        return;
                    }
                    settle(held as string);
                });
            }),
    );
    assert.ok(text.includes("retries"));
});

test("a callback given no options is still the callback", async () => {
    const held = await whileRunning(
        async () => new Promise<unknown>((settle) => files.readFile("/notes.txt", (_error: unknown, text: unknown) => settle(text))),
    );
    assert.ok(held instanceof Buffer);
});

test("a callback is told about a file that is not there rather than throwing", async () => {
    const thrown = await whileRunning(
        async () => new Promise<{ code?: string }>((settle) => files.readFile("/missing.txt", "utf8", (error: unknown) => settle(error as { code?: string }))),
    );
    assert.equal(thrown.code, "ENOENT");
});

test("the promise half reads and writes the same tree the rest does", async () => {
    await whileRunning(async () => {
        await files.promises.writeFile("/held.txt", "kept");
        assert.equal(await files.promises.readFile("/held.txt", "utf8"), "kept");
        assert.equal(files.readFileSync("/held.txt", "utf8"), "kept");
    });
});

test("a run that has not started reads the machine's own disk", async () => {
    assert.equal(files.existsSync("/settings.json"), false);
});
