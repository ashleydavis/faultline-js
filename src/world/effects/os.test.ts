// Tests for the replacement of `node:os`.
//
// The goal is to show that a run sees the same machine on every machine, that asking who the user
// is can fail as `docs/FAILURES.md` says and that with no run in flight every call is handed to the
// real module. The real module's calls are replaced here by stand-ins, so the test checks each is
// handed on with the same arguments and its answer handed back. The machine is never read. The
// method is to put a run in flight, ask the machine what code under test asks it and read back the
// answers.

import assert from "node:assert/strict";
import realOs from "node:os";
import { describe, jest, test } from "@jest/globals";
import { runWith } from "../current.ts";
import type { PlannedFailure } from "../injector.ts";
import { RunSubject } from "../subject.ts";
import os from "./os.ts";

// The real module with every call that reads the machine replaced by a stand-in that answers with a
// value naming itself.
jest.mock("node:os", () => {
    const actual = jest.requireActual<typeof realOs>("node:os");
    const replaced: Record<string, unknown> = {
        ...actual,
    };
    for (const name of ["homedir", "tmpdir", "hostname", "platform", "type", "arch", "machine", "release", "version", "uptime", "totalmem", "freemem", "availableParallelism", "loadavg", "cpus", "networkInterfaces", "userInfo"]) {
        replaced[name] = jest.fn(() => `real ${name}`);
    }
    return replaced;
});

// The stand-ins above, as the test reads them back.
const realModule = jest.requireMock<Record<string, jest.Mock>>("node:os");

// Runs `work` with one run in flight that injects `planned`, or nothing when it is undefined.
export function runInFlight<T>(work: (subject: RunSubject) => T, planned: PlannedFailure | undefined): T {
    const subject = new RunSubject(1, planned);
    const before = runWith(subject);
    try {
        return work(subject);
    }
    finally {
        runWith(before);
    }
}

// Calls the replacement's function `name` with no arguments. The functions take different
// arguments, so they are called by name rather than through one type.
export function callByName(name: string): unknown {
    return Reflect.apply(Reflect.get(os, name), os, []);
}

describe("the machine a run sees", () => {
    test("a run sees the same machine whoever runs it", () => {
        runInFlight(() => {
            assert.equal(os.homedir(), "/home/faultline");
            assert.equal(os.tmpdir(), "/tmp");
            assert.equal(os.hostname(), "faultline");
            assert.equal(os.platform(), "linux");
            assert.equal(os.type(), "Linux");
            assert.equal(os.arch(), "x64");
            assert.equal(os.machine(), "x86_64");
            assert.equal(os.release(), "6.0.0");
            assert.equal(os.version(), "#1 SMP");
            assert.equal(os.uptime(), 0);
            assert.equal(os.totalmem(), 2147483648);
            assert.equal(os.freemem(), 1073741824);
            assert.equal(os.availableParallelism(), 1);
            assert.deepEqual(os.loadavg(), [0, 0, 0]);
            assert.equal(os.cpus().length, 1);
            assert.deepEqual(Object.keys(os.networkInterfaces()), ["lo"]);
        }, undefined);
    });

    test("the machine's uptime moves with the run's clock", () => {
        assert.equal(runInFlight((subject) => {
            subject.clock.advance(5000);
            return os.uptime();
        }, undefined), 5);
    });
});

describe("the user", () => {
    test("the user is the run's own and asking who it is is a place", () => {
        runInFlight((subject) => {
            assert.deepEqual(os.userInfo(), {
                username: "faultline",
                uid: 1000,
                gid: 1000,
                shell: "/bin/sh",
                homedir: "/home/faultline",
            });
            assert.deepEqual(subject.injector.reached, [
                {
                    place: {
                        effect: "machine",
                        occurrence: 0,
                    },
                    failures: ["user-has-no-entry"],
                },
            ]);
        }, undefined);
    });

    test("a user with no entry fails with ENOENT", () => {
        runInFlight(() => {
            assert.throws(() => os.userInfo(), {
                code: "ENOENT",
                syscall: "uv_os_get_passwd",
            });
        }, {
            place: {
                effect: "machine",
                occurrence: 0,
            },
            failure: "user-has-no-entry",
        });
    });
});

describe("with no run in flight", () => {
    test("every call is handed to the real module and its answer comes back", () => {
        // Every call that reads the machine and takes no arguments.
        for (const name of ["homedir", "tmpdir", "hostname", "platform", "type", "arch", "machine", "release", "version", "uptime", "totalmem", "freemem", "availableParallelism", "loadavg", "cpus", "networkInterfaces"]) {
            assert.equal(callByName(name), `real ${name}`, name);
            assert.equal(realModule[name].mock.calls.length, 1, name);
        }
        const options = {
            encoding: "utf8",
        };
        assert.equal(os.userInfo(options), "real userInfo");
        assert.deepEqual(Array.from(realModule.userInfo.mock.lastCall ?? []), [options]);
        assert.equal(os.EOL, realOs.EOL);
    });
});
