// What the copy imports in place of `node:os`.
//
// The machine a run sees is the same on every machine Faultline runs on, so a replay gives the same
// answer anywhere: one user, one host name, one processor and fixed amounts of memory. Asking who
// the user is can fail as `docs/FAILURES.md` lists.

import realOs from "node:os";
import { nowRunning } from "../current.ts";
import { CodedError } from "../effects.ts";

// Everything the real module has and this one does not replace: its constants and `EOL`. Every call
// that reads the machine is declared below, and a name declared here wins over the one the star
// brings in.
export * from "node:os";

// The user a run runs as. A user that is not root, so code that refuses to run as root runs.
const runUser = {
    username: "faultline",
    uid: 1000,
    gid: 1000,
    shell: "/bin/sh",
    homedir: "/home/faultline",
};

// How much memory the machine a run sees has, and how much of it is free: a small machine with
// half of it in use.
const totalMemoryBytes = 2147483648;

// The memory a run's machine has free.
const freeMemoryBytes = 1073741824;

// What `os.userInfo` hands back.
interface UserInfo {
    username: string;
    uid: number;
    gid: number;
    shell: string | null;
    homedir: string;
}

export function userInfo(options?: unknown): UserInfo {
    const running = nowRunning();
    if (running === undefined) {
        return realOs.userInfo(options as never) as UserInfo;
    }
    const failure = running.injector.check("machine", ["user-has-no-entry"]);
    if (failure !== undefined) {
        throw new CodedError("ENOENT", "A system error occurred: uv_os_get_passwd returned ENOENT (no such file or directory)", "uv_os_get_passwd");
    }
    return {
        ...runUser,
    };
}

export function homedir(): string {
    return nowRunning() === undefined ? realOs.homedir() : runUser.homedir;
}

export function tmpdir(): string {
    return nowRunning() === undefined ? realOs.tmpdir() : "/tmp";
}

export function hostname(): string {
    return nowRunning() === undefined ? realOs.hostname() : "faultline";
}

export function platform(): NodeJS.Platform {
    return nowRunning() === undefined ? realOs.platform() : "linux";
}

export function type(): string {
    return nowRunning() === undefined ? realOs.type() : "Linux";
}

export function arch(): string {
    return nowRunning() === undefined ? realOs.arch() : "x64";
}

export function machine(): string {
    return nowRunning() === undefined ? realOs.machine() : "x86_64";
}

export function release(): string {
    return nowRunning() === undefined ? realOs.release() : "6.0.0";
}

export function version(): string {
    return nowRunning() === undefined ? realOs.version() : "#1 SMP";
}

// How long the machine has been up, read from the run's clock, so it moves when timers run.
export function uptime(): number {
    const running = nowRunning();
    if (running === undefined) {
        return realOs.uptime();
    }
    return Math.floor((running.clock.stampMs() - running.clock.startedAtMs()) / 1000);
}

export function totalmem(): number {
    return nowRunning() === undefined ? realOs.totalmem() : totalMemoryBytes;
}

export function freemem(): number {
    return nowRunning() === undefined ? realOs.freemem() : freeMemoryBytes;
}

export function availableParallelism(): number {
    return nowRunning() === undefined ? realOs.availableParallelism() : 1;
}

export function loadavg(): number[] {
    return nowRunning() === undefined ? realOs.loadavg() : [0, 0, 0];
}

export function cpus(): realOs.CpuInfo[] {
    if (nowRunning() === undefined) {
        return realOs.cpus();
    }
    return [
        {
            model: "Faultline",
            speed: 1000,
            times: {
                user: 0,
                nice: 0,
                sys: 0,
                idle: 0,
                irq: 0,
            },
        },
    ];
}

export function networkInterfaces(): NodeJS.Dict<realOs.NetworkInterfaceInfo[]> {
    if (nowRunning() === undefined) {
        return realOs.networkInterfaces();
    }
    return {
        lo: [
            {
                address: "127.0.0.1",
                netmask: "255.0.0.0",
                family: "IPv4",
                mac: "00:00:00:00:00:00",
                internal: true,
                cidr: "127.0.0.1/8",
            },
        ],
    };
}

// What `import os from "node:os"` gets.
export default {
    ...realOs,
    userInfo,
    homedir,
    tmpdir,
    hostname,
    platform,
    type,
    arch,
    machine,
    release,
    version,
    uptime,
    totalmem,
    freemem,
    availableParallelism,
    loadavg,
    cpus,
    networkInterfaces,
};
