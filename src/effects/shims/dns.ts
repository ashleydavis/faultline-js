// What the copy imports in place of `node:dns` and `node:dns/promises`.
//
// A name a run looks up resolves to one address until the injector says this lookup goes wrong, and
// then it fails the way a real lookup fails: a name that is not there, a server that will not
// answer, a query that times out.

import { nowRunning } from "../current.ts";
import { CodedError } from "../effects.ts";

// The address every name resolves to when the lookup works. It is the loopback address, because
// nothing is dialled and a caller that prints what it resolved prints something it recognises.
const resolvesTo = "127.0.0.1";

// Fails the way a real lookup fails, or returns when the injector asked for no failure.
function refuse(name: string, call: string): void {
    const failure = nowRunning()?.injector.check("net");
    if (failure === "dns") {
        throw new CodedError("ENOTFOUND", `getaddrinfo ENOTFOUND ${name}`);
    }
    if (failure === "timeout") {
        throw new CodedError("ETIMEOUT", `query${call} ETIMEOUT ${name}`);
    }
    if (failure === "refused") {
        throw new CodedError("ECONNREFUSED", `query${call} ECONNREFUSED ${name}`);
    }
    if (failure === "server-error") {
        throw new CodedError("SERVFAIL", `query${call} SERVFAIL ${name}`);
    }
    if (failure === "bad-body") {
        throw new CodedError("EBADRESP", `query${call} EBADRESP ${name}`);
    }
}

export function lookup(name: string, options: unknown, callback?: unknown): void {
    const done = (typeof options === "function" ? options : callback) as (error: unknown, address?: string, family?: number) => void;
    try {
        refuse(name, "A");
    }
    catch (thrown) {
        queueMicrotask(() => done(thrown));
        return;
    }
    queueMicrotask(() => done(null, resolvesTo, 4));
}

export function resolve4(name: string, callback: unknown): void {
    const done = callback as (error: unknown, addresses?: string[]) => void;
    try {
        refuse(name, "A");
    }
    catch (thrown) {
        queueMicrotask(() => done(thrown));
        return;
    }
    queueMicrotask(() => done(null, [resolvesTo]));
}

export function resolve(name: string, callback: unknown): void {
    resolve4(name, callback);
}

// The promise half, which `node:dns/promises` is and `dns.promises` holds.
export const promises = {
    lookup: async (name: string): Promise<{ address: string; family: number }> => {
        refuse(name, "A");
        return { address: resolvesTo, family: 4 };
    },
    resolve4: async (name: string): Promise<string[]> => {
        refuse(name, "A");
        return [resolvesTo];
    },
    resolve: async (name: string): Promise<string[]> => {
        refuse(name, "A");
        return [resolvesTo];
    },
};

// What `import dns from "node:dns"` gets.
export default { lookup, resolve, resolve4, promises };
