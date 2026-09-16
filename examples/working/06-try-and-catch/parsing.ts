// A try is two paths: the catch, and the try finishing without throwing.

// Reads a number out of text, or says it could not.
export function numberFrom(text: string): number {
    try {
        const held = JSON.parse(text) as { value?: number };
        return held.value ?? 0;
    }
    catch {
        return -1;
    }
}
