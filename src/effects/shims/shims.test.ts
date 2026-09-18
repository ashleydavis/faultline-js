import assert from "node:assert/strict";
import test from "node:test";
import { runWith } from "../current.ts";
import type { EffectName } from "../../runtime/index.ts";
import { RunSubject } from "../subject.ts";
import child from "./child-process.ts";
import dns from "./dns.ts";
import http, { type IncomingMessage } from "./http.ts";
import { shimFor } from "./index.ts";
import net from "./net.ts";

// Runs `work` with one run in flight, so the replacements answer from that run.
async function whileRunning<T>(mode: "clean" | "faulting", work: () => T | Promise<T>): Promise<T> {
    const before = runWith(new RunSubject(3, mode));
    try {
        return await work();
    }
    finally {
        runWith(before);
    }
}

// Runs `work` with one run in flight and one named failure queued, so the next call to that effect
// gets it.
async function asked<T>(effect: EffectName, failure: string, work: () => T | Promise<T>): Promise<T> {
    const subject = new RunSubject(3, "clean");
    subject.injector.fail(effect, failure);
    const before = runWith(subject);
    try {
        return await work();
    }
    finally {
        runWith(before);
    }
}

test("both spellings of a built in module name the same replacement", () => {
    assert.equal(shimFor("node:fs"), shimFor("fs"));
    assert.equal(shimFor("node:http"), shimFor("http"));
});

test("a secure request and a plain one are the same replacement", () => {
    assert.equal(shimFor("node:https"), shimFor("node:http"));
});

test("a module the run does not replace is left where it is", () => {
    assert.equal(shimFor("node:path"), undefined);
    assert.equal(shimFor("express"), undefined);
});

test("a request that works answers with a body that parses", async () => {
    const body = await whileRunning("clean", async () =>
        new Promise<string>((settle) => {
            http.get("http://example.com/", (answer: IncomingMessage) => {
                let held = "";
                answer.on("data", (piece: Buffer) => { held += piece.toString(); });
                answer.on("end", () => settle(held));
            });
        }));
    assert.deepEqual(JSON.parse(body), { ok: true });
});

test("a refused request fails the way the runtime fails", async () => {
    const thrown = await asked("net", "refused", async () =>
        new Promise<{ code?: string }>((settle) => {
            http.get("http://example.com/", () => settle({})).on("error", (error: { code?: string }) => settle(error));
        }));
    assert.equal(thrown.code, "ECONNREFUSED");
});

test("a request the server answered badly comes back with a body that will not parse", async () => {
    const body = await asked("net", "bad-body", async () =>
        new Promise<string>((settle) => {
            http.get("http://example.com/", (answer: IncomingMessage) => {
                let held = "";
                answer.on("data", (piece: Buffer) => { held += piece.toString(); });
                answer.on("end", () => settle(held));
            });
        }));
    assert.throws(() => JSON.parse(body));
});

test("a server that answered with an error says so in the status", async () => {
    const status = await asked("net", "server-error", async () =>
        new Promise<number | undefined>((settle) => {
            http.get("http://example.com/", (answer: IncomingMessage) => settle(answer.statusCode));
        }));
    assert.equal(status, 500);
});

test("a server the code under test makes listens on nothing and still says it is up", async () => {
    const up = await whileRunning("clean", async () =>
        new Promise<boolean>((settle) => {
            http.createServer(() => undefined).listen(0, () => settle(true));
        }));
    assert.equal(up, true);
});

test("a connection that works says it is open", async () => {
    const how = await whileRunning("clean", async () =>
        new Promise<string>((settle) => {
            const socket = net.createConnection(80, "example.com", () => settle("up"));
            socket.on("error", () => settle("down"));
        }));
    assert.equal(how, "up");
});

test("a name that resolves gives one address", async () => {
    const found = await whileRunning("clean", async () => dns.promises.resolve4("example.com"));
    assert.deepEqual(found, ["127.0.0.1"]);
});

test("a name that does not resolve fails the way the runtime fails", async () => {
    await asked("net", "dns", async () => {
        await assert.rejects(dns.promises.resolve4("example.com"), (thrown: { code?: string }) => thrown.code === "ENOTFOUND");
    });
});

test("a program that runs answers with what it printed", async () => {
    const said = await whileRunning("clean", () => child.execSync("git --version"));
    assert.equal(said.toString(), "ok\n");
});

test("a program that is not there fails the way the runtime fails", async () => {
    await asked("process", "missing", () => {
        assert.throws(() => child.execSync("nope"), (thrown: { code?: string }) => thrown.code === "ENOENT");
    });
});

test("a program that ends badly throws with the status it ended with", async () => {
    await asked("process", "failed", () => {
        assert.throws(() => child.execSync("nope"), (thrown: { status?: number }) => thrown.status === 1);
    });
});

test("a started program hands back both its streams and ends", async () => {
    const ended = await whileRunning("clean", async () =>
        new Promise<number>((settle) => {
            child.spawn("git").on("close", (status: number) => settle(status));
        }));
    assert.equal(ended, 0);
});
