// Three reads, each with its own branch for going wrong. Only the third read failing reaches the
// last one, and a draw lands there rarely.

import type { Files } from "faultline";

export async function allThree(files: Files): Promise<string> {
    try {
        await files.read("/settings.json");
    }
    catch {
        return "the first went wrong";
    }
    try {
        await files.read("/notes.txt");
    }
    catch {
        return "the second went wrong";
    }
    try {
        await files.read("/settings.json");
    }
    catch {
        return "the third went wrong";
    }
    return "all three read";
}
