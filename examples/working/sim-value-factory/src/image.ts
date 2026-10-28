//
// A branch per image format, which no value Faultline builds from the type reaches.
//

import assert from "node:assert/strict";

//
// The bytes a PNG file starts with, written as character codes the way a format's documentation
// gives them.
//
const PNG_START = String.fromCharCode(0x89, 0x50, 0x4e, 0x47);

//
// The bytes a GIF file starts with, written the same way.
//
const GIF_START = String.fromCharCode(0x47, 0x49, 0x46, 0x38);

//
// What reads the first bytes of an image file.
//
export interface IImageLoader {
    //
    // Gives the first bytes of the file, as text.
    //
    load(): string;
}

//
// Says which format the image is, from its first bytes.
//
export function formatOf(loader: IImageLoader): string {
    const bytes = loader.load();
    assert(typeof bytes === "string");
    if (bytes.startsWith(PNG_START)) {
        return "png";
    }
    if (bytes.startsWith(GIF_START)) {
        return "gif";
    }
    return "unknown";
}
