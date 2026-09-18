export async function withRetries<T>(work: () => Promise<T>, times = 3): Promise<T | null> {
    let last: unknown;
    for (let at = 0; at < times; at += 1) {
        try {
            return await work();
        }
        catch (thrown) {
            last = thrown;
            if (at === times - 1) {
                break;
            }
            await new Promise<void>((settle) => setTimeout(settle, 100 * (at + 1)));
        }
    }
    if (last instanceof TypeError) {
        return null;
    }
    return null;
}

export function parseRange(text: string): [number, number] | null {
    const parts = text.split("-");
    if (parts.length !== 2) {
        return null;
    }
    const low = Number(parts[0]);
    const high = Number(parts[1]);
    if (Number.isNaN(low) || Number.isNaN(high)) {
        return null;
    }
    if (low > high) {
        return [high, low];
    }
    return [low, high];
}
