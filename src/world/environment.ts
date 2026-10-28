// The simulated environment variables one run owns.
//
// They start empty, so a call reads no variable of the machine's and a replay reads the same ones
// on every machine. A scenario sets the variables a call needs. Every read of a variable is a place,
// where the variable can read as not set or as set to an empty value.

import type { Injector } from "./injector.ts";

// The environment variables of one run.
export class RunEnvironment {
    // Every variable set, by name.
    private readonly variables = new Map<string, string>();

    // What decides which reads go wrong.
    private readonly injector: Injector;

    constructor(injector: Injector) {
        this.injector = injector;
    }

    // What a variable reads, as `process.env.NAME` reads it.
    read(name: string): string | undefined {
        const failure = this.injector.check("environment", ["variable-not-set", "variable-set-to-an-empty-value"]);
        if (failure === "variable-not-set") {
            return undefined;
        }
        if (failure === "variable-set-to-an-empty-value") {
            return "";
        }
        return this.variables.get(name);
    }

    // Sets a variable. Node keeps every value as text, so this does too.
    set(name: string, value: unknown): void {
        this.variables.set(name, String(value));
    }

    // Takes a variable away.
    unset(name: string): void {
        this.variables.delete(name);
    }

    // Whether a variable is set, as `"NAME" in process.env` asks. Asking is not a read of the
    // value, so it is not a place.
    has(name: string): boolean {
        return this.variables.has(name);
    }

    // The names of every variable set, in the order they were set, as `Object.keys(process.env)`
    // lists them.
    names(): string[] {
        return [...this.variables.keys()];
    }
}
