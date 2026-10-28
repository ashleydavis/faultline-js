//
// A value factory per image format, so the branch that handles each one is reached.
//

import assert from "node:assert/strict";
import type { IImageLoader } from "./image.ts";

//
// A loader whose file is a PNG.
//
export function pngLoader(): IImageLoader {
    const loader = {
        load(): string {
            return String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a);
        },
    };
    assert(loader.load().length > 4);
    return loader;
}

//
// A loader whose file is a GIF.
//
export function gifLoader(): IImageLoader {
    const loader = {
        load(): string {
            return String.fromCharCode(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
        },
    };
    assert(loader.load().length > 4);
    return loader;
}

//
// A loader whose file is neither, so the last line is reached too.
//
export function textLoader(): IImageLoader {
    const loader = {
        load(): string {
            return "plain text";
        },
    };
    assert(loader.load().length > 0);
    return loader;
}
