// What the copy imports in place of `node:dns`.
//
// A name a run looks up resolves to the loopback address unless a failure is injected, and then it
// fails the way a real lookup fails: a name that does not resolve, a name server that fails or a
// lookup that finds no address.

import realDns from "node:dns";
import { promisify } from "node:util";
import { nowRunning } from "../current.ts";
import { CodedError, codeOf } from "../effects.ts";
import { lookupFailures, resolvedAddress } from "../network.ts";

// Everything the real module has and this one does not replace: its error codes and constants.
// Every call that reaches the network is declared below, and a name declared here wins over the one
// the star brings in.
export * from "node:dns";

// The system call Node names for each kind of lookup.
type LookupCall = "getaddrinfo" | "queryA" | "queryAaaa";

// Fails the way a real lookup fails when the injector says so, and returns when it does not. A
// lookup made with no run in flight is the tool's own and is not asked about.
function refuse(name: string, call: LookupCall): void {
    const failure = nowRunning()?.network.check(lookupFailures);
    if (failure === undefined) {
        return;
    }
    const code = codeOf(failure);
    throw Object.assign(new CodedError(code, `${call} ${code} ${name}`, call), {
        hostname: name,
    });
}

// The addresses a lookup gives, for a caller that asked for every address.
export interface LookupAddress {
    // The address.
    address: string;

    // Four for an IPv4 address.
    family: number;
}

// Answers a lookup as `lookup` does: one address, or every address when `all` was asked for.
function lookupAnswer(options: unknown): string | LookupAddress[] {
    const all = options !== null && typeof options === "object" && (options as { all?: boolean }).all === true;
    if (all) {
        return [
            {
                address: resolvedAddress,
                family: 4,
            },
        ];
    }
    return resolvedAddress;
}

export function lookup(name: string, options: unknown, callback?: unknown): void {
    if (nowRunning() === undefined) {
        (realDns.lookup as (...args: unknown[]) => void)(name, options, callback);
        return;
    }
    const done = (typeof options === "function" ? options : callback) as (error: unknown, address?: unknown, family?: number) => void;
    try {
        refuse(name, "getaddrinfo");
    }
    catch (thrown) {
        queueMicrotask(() => done(thrown));
        return;
    }
    const answer = lookupAnswer(typeof options === "function" ? undefined : options);
    queueMicrotask(() => (typeof answer === "string" ? done(null, answer, 4) : done(null, answer)));
}

// What `util.promisify` makes of `lookup`: the promise form, as Node's own gives it.
Object.defineProperty(lookup, promisify.custom, {
    value: (name: string, options?: unknown): Promise<LookupAddress | LookupAddress[]> => promises.lookup(name, options),
});

// One of the `resolve` calls, in its callback form.
function resolveWith(name: string, callback: unknown, call: LookupCall, addresses: string[], realCall: (...args: unknown[]) => void): void {
    if (nowRunning() === undefined) {
        realCall(name, callback);
        return;
    }
    const done = callback as (error: unknown, addresses?: string[]) => void;
    try {
        refuse(name, call);
    }
    catch (thrown) {
        queueMicrotask(() => done(thrown));
        return;
    }
    queueMicrotask(() => done(null, addresses));
}

export function resolve4(name: string, callback: unknown): void {
    resolveWith(name, callback, "queryA", [resolvedAddress], realDns.resolve4 as (...args: unknown[]) => void);
}

export function resolve6(name: string, callback: unknown): void {
    resolveWith(name, callback, "queryAaaa", ["::1"], realDns.resolve6 as (...args: unknown[]) => void);
}

export function resolve(name: string, typeOrCallback: unknown, callback?: unknown): void {
    const done = typeof typeOrCallback === "function" ? typeOrCallback : callback;
    if (typeOrCallback === "AAAA") {
        resolve6(name, done);
        return;
    }
    resolve4(name, done);
}

// The promise half, which `node:dns/promises` is and `dns.promises` holds.
export const promises = {
    lookup: async (name: string, options?: unknown): Promise<LookupAddress | LookupAddress[]> => {
        if (nowRunning() === undefined) {
            return realDns.promises.lookup(name, options as never) as Promise<LookupAddress>;
        }
        refuse(name, "getaddrinfo");
        const answer = lookupAnswer(options);
        return typeof answer === "string" ? {
            address: answer,
            family: 4,
        } : answer;
    },
    resolve4: async (name: string): Promise<string[]> => {
        if (nowRunning() === undefined) {
            return realDns.promises.resolve4(name);
        }
        refuse(name, "queryA");
        return [resolvedAddress];
    },
    resolve6: async (name: string): Promise<string[]> => {
        if (nowRunning() === undefined) {
            return realDns.promises.resolve6(name);
        }
        refuse(name, "queryAaaa");
        return ["::1"];
    },
    resolve: async (name: string, type?: string): Promise<string[]> => {
        if (type === "AAAA") {
            return promises.resolve6(name);
        }
        return promises.resolve4(name);
    },
};

// What `import dns from "node:dns"` gets: the real module's codes and constants with every call
// that reaches the network replaced.
export default {
    ...realDns,
    lookup,
    resolve,
    resolve4,
    resolve6,
    promises,
};
