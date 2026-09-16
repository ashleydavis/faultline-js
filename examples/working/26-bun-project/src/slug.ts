// Turns a title into something that goes in a URL.
export function slugify(text: string): string {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "") {
        return "untitled";
    }
    return trimmed.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
