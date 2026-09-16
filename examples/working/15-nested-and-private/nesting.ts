// A private function, and a callback that belongs to the function that wrote it.

// Not exported, so no call reaches it directly. Its paths are ticked by the one below.
function trimmed(text: string): string {
    if (text.length > 4) {
        return text.slice(0, 4);
    }
    return text;
}

// Exported, and what reaches everything above and below it.
export function shortNames(names: string[]): string[] {
    return names.map((name) => {
        if (name === "") {
            return "(none)";
        }
        return trimmed(name);
    });
}
