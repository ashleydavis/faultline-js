// One factory per format, so the branch that handles each one is reached.

import type { ImageLoader } from "./image.ts";

// A file that is a PNG.
export function pngLoader(): ImageLoader {
    return { load: () => "PNG and the rest" };
}

// A file that is a GIF.
export function gifLoader(): ImageLoader {
    return { load: () => "GIF89a and the rest" };
}
