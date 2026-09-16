// A branch per format, which no value made up from the type reaches.

// What a loader hands back.
export interface ImageLoader {
    // The first bytes of the file, as text.
    load(): string;
}

// Which format the bytes are.
export function formatOf(loader: ImageLoader): string {
    const bytes = loader.load();
    if (bytes.startsWith("PNG")) {
        return "png";
    }
    if (bytes.startsWith("GIF")) {
        return "gif";
    }
    return "unknown";
}
