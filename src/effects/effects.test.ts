import assert from "node:assert/strict";
import test from "node:test";
import { CodedError, RunClock, RunFiles, RunNet, RunWriter } from "./effects.ts";
import { RunInjector } from "./injector.ts";
import { SeededRng } from "./random.ts";

// An injector that fails only what a test asks it to.
function clean(): RunInjector {
    return new RunInjector(new SeededRng(1), "clean");
}

test("a coded error carries the code a caller switches on", () => {
    const thrown = new CodedError("ENOENT", "gone");
    assert.equal(thrown.code, "ENOENT");
    assert.equal(thrown.message, "gone");
    assert.ok(thrown instanceof Error);
});

test("the clock starts where it was told to", () => {
    assert.equal(new RunClock(clean(), 1000).now(), 1000);
});

test("the clock reads the same time until it is moved", () => {
    const clock = new RunClock(clean(), 1000);
    assert.equal(clock.now(), clock.now());
});

test("a clock told to go backwards reads earlier than it did", () => {
    const injector = clean();
    const clock = new RunClock(injector, 1000000);
    const before = clock.now();
    injector.fail("clock", "backwards");
    assert.ok(clock.now() < before);
});

test("a clock told to jump reads later, and stays there", () => {
    const injector = clean();
    const clock = new RunClock(injector, 1000000);
    injector.fail("clock", "jump");
    const jumped = clock.now();
    assert.ok(jumped > 1000000);
    assert.equal(clock.now(), jumped);
});

test("the monotonic clock starts at nothing and only goes forward", () => {
    const clock = new RunClock(clean(), 1000);
    assert.equal(clock.monotonic(), 0);
    clock.advance(50);
    assert.equal(clock.monotonic(), 50);
});

test("a sleep moves the clock rather than taking time", async () => {
    const clock = new RunClock(clean(), 1000);
    const started = Date.now();
    await clock.sleep(3600000);
    assert.equal(clock.now(), 1000 + 3600000);
    assert.ok(Date.now() - started < 1000);
});

test("a sleep for a negative time moves the clock nowhere", async () => {
    const clock = new RunClock(clean(), 1000);
    await clock.sleep(-5);
    assert.equal(clock.now(), 1000);
});

test("the network answers when it is not told to fail", async () => {
    const net = new RunNet(clean(), new SeededRng(1));
    const answer = await net.fetch("https://example.com/");
    assert.ok(answer.status === 200 || answer.status === 204);
});

test("the network hands out a different body on each call", async () => {
    const net = new RunNet(clean(), new SeededRng(1));
    const bodies: string[] = [];
    for (let index = 0; index < 5; index += 1) {
        bodies.push(await (await net.fetch("https://example.com/")).text());
    }
    assert.ok(new Set(bodies).size > 1);
});

test("a refused connection throws the code a refused connection throws", async () => {
    const injector = clean();
    const net = new RunNet(injector, new SeededRng(1));
    injector.fail("net", "refused");
    await assert.rejects(net.fetch("https://example.com/"), (thrown: CodedError) => thrown.code === "ECONNREFUSED");
});

test("a name that does not resolve and a connection that times out each throw their own code", async () => {
    const injector = clean();
    const net = new RunNet(injector, new SeededRng(1));
    injector.fail("net", "dns");
    await assert.rejects(net.fetch("https://example.com/"), (thrown: CodedError) => thrown.code === "ENOTFOUND");
    injector.fail("net", "timeout");
    await assert.rejects(net.fetch("https://example.com/"), (thrown: CodedError) => thrown.code === "ETIMEDOUT");
});

test("a server error comes back as a response, not as a throw", async () => {
    const injector = clean();
    const net = new RunNet(injector, new SeededRng(1));
    injector.fail("net", "server-error");
    const answer = await net.fetch(new URL("https://example.com/"));
    assert.equal(answer.status, 503);
    assert.equal(answer.ok, false);
});

test("a bad body says it is JSON and is not", async () => {
    const injector = clean();
    const net = new RunNet(injector, new SeededRng(1));
    injector.fail("net", "bad-body");
    const answer = await net.fetch("https://example.com/");
    assert.equal(answer.headers.get("content-type"), "application/json");
    await assert.rejects(answer.json());
});

test("the files a run starts with can be read", async () => {
    const files = new RunFiles(clean());
    assert.match(await files.read("/settings.json"), /retries/);
    assert.equal(await files.exists("/settings.json"), true);
});

test("a path the run was never told about is there and holds something", async () => {
    const files = new RunFiles(clean());
    assert.ok((await files.read("/gone")).length > 0);
    assert.equal(await files.exists("/gone"), true);
});

test("a read the injector fails says so with the code a missing file has", async () => {
    const injector = clean();
    injector.fail("files", "missing");
    await assert.rejects(new RunFiles(injector).read("/settings.json"), (thrown: CodedError) => thrown.code === "ENOENT");
});

test("what a path the run was never told about holds is the fields the file being measured reads", async () => {
    const files = new RunFiles(clean());
    files.holds(["retries", "verbose"], [7, true], 2);
    assert.deepEqual(JSON.parse(await files.read("/anything")), { retries: 7, verbose: true });
});

test("one field is left out per turn, so the code filling in a default is reached", async () => {
    const files = new RunFiles(clean());
    const seen = new Set<string>();
    for (let turn = 0; turn < 3; turn += 1) {
        files.holds(["retries", "verbose"], [7, true], turn);
        seen.add(await files.read("/anything"));
    }
    assert.equal(seen.size, 3);
});

test("what was written can be read back", async () => {
    const files = new RunFiles(clean());
    await files.write("/a/b.txt", "kept");
    assert.equal(await files.read("/a/b.txt"), "kept");
    assert.deepEqual(await files.list("/a"), ["b.txt"]);
});

test("bytes come back as the text encoded", async () => {
    const files = new RunFiles(clean());
    await files.write("/b.txt", "ab");
    assert.deepEqual(await files.readBytes("/b.txt"), new Uint8Array([97, 98]));
});

test("a file that was removed is gone, and reading it says so the way the runtime says it", async () => {
    const files = new RunFiles(clean());
    await files.write("/c.txt", "x");
    await files.remove("/c.txt");
    await assert.rejects(files.read("/c.txt"), (thrown: CodedError) => thrown.code === "ENOENT");
    assert.equal(await files.exists("/c.txt"), false);
});

test("a removal the injector fails says so with the code a missing file has", async () => {
    const injector = clean();
    injector.fail("files", "missing");
    await assert.rejects(new RunFiles(injector).remove("/c.txt"), (thrown: CodedError) => thrown.code === "ENOENT");
});

test("a listing names each directory once", async () => {
    const files = new RunFiles(clean());
    await files.write("/d/one/x", "1");
    await files.write("/d/one/y", "2");
    await files.write("/d/two", "3");
    assert.deepEqual(await files.list("/d"), ["one", "two"]);
});

test("each way the files can fail throws the code that way throws", async () => {
    const wanted: [string, string][] = [
        ["missing", "ENOENT"],
        ["denied", "EACCES"],
        ["io", "EIO"],
        ["is-directory", "EISDIR"],
        ["full", "ENOSPC"],
    ];
    for (const [failure, code] of wanted) {
        const injector = clean();
        const files = new RunFiles(injector);
        injector.fail("files", failure);
        await assert.rejects(files.read("/settings.json"), (thrown: CodedError) => thrown.code === code);
    }
});

test("the writer takes everything it is given and says so", async () => {
    const writer = new RunWriter(clean());
    assert.equal(await writer.write("four"), 4);
    assert.equal(writer.written(), "four");
});

test("a short write takes one character and says one", async () => {
    const injector = clean();
    const writer = new RunWriter(injector);
    injector.fail("writer", "short");
    assert.equal(await writer.write("four"), 1);
    assert.equal(writer.written(), "f");
});

test("a short write of nothing takes nothing", async () => {
    const injector = clean();
    const writer = new RunWriter(injector);
    injector.fail("writer", "short");
    assert.equal(await writer.write(""), 0);
});

test("a broken pipe throws and keeps the writer open", async () => {
    const injector = clean();
    const writer = new RunWriter(injector);
    injector.fail("writer", "broken-pipe");
    await assert.rejects(writer.write("x"), (thrown: CodedError) => thrown.code === "EPIPE");
    assert.equal(await writer.write("y"), 1);
});

test("a closed writer refuses everything after it", async () => {
    const injector = clean();
    const writer = new RunWriter(injector);
    injector.fail("writer", "closed");
    await assert.rejects(writer.write("x"));
    await assert.rejects(writer.write("y"), (thrown: CodedError) => thrown.code === "ERR_STREAM_WRITE_AFTER_END");
});

test("a writer that has ended refuses what comes after", async () => {
    const writer = new RunWriter(clean());
    await writer.end();
    await assert.rejects(writer.write("x"), (thrown: CodedError) => thrown.code === "ERR_STREAM_WRITE_AFTER_END");
});
