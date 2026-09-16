// Code that calls a function it was given, and code that guards against a value that is not there.

// Applies a function to each item, and counts the ones it threw on.
export function safelyMap(items: number[], convert: (value: number) => string): number {
    let failed = 0;
    for (const item of items) {
        try {
            convert(item);
        }
        catch {
            failed += 1;
        }
    }
    return failed;
}

// Waits for a function that hands back a promise, which sometimes rejects.
export async function safelyAsk(ask: () => Promise<string>): Promise<string> {
    try {
        return await ask();
    }
    catch {
        return "the call went wrong";
    }
}

// A guard for a value the type says is always there and a running program sometimes is not.
export function lengthOf(text: string): number {
    if (text === null || text === undefined) {
        return 0;
    }
    return text.length;
}
