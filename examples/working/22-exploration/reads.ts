// Three reads, each with its own branch for going wrong. Only the third read failing reaches the
// last one, and a draw lands there rarely.

import fs from "node:fs/promises";

export async function allThree(): Promise<string> {
    try {
        await fs.readFile("/settings.json", "utf8");
    }
    catch {
        return "the first went wrong";
    }
    try {
        await fs.readFile("/notes.txt", "utf8");
    }
    catch {
        return "the second went wrong";
    }
    try {
        await fs.readFile("/settings.json", "utf8");
    }
    catch {
        return "the third went wrong";
    }
    return "all three read";
}
