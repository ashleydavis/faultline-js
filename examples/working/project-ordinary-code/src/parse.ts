//
// Reading a settings file, which is what most code does with the filesystem.
//

import assert from "node:assert/strict";
import fs from "node:fs/promises";

//
// What a settings file holds, with every field filled in.
//
export interface ISettings {
    //
    // How many times to try again after a failure.
    //
    retries: number;

    //
    // Whether to say more about what is being done.
    //
    verbose: boolean;
}

//
// What a settings file may leave out.
//
export interface IWrittenSettings {
    //
    // How many times to try again after a failure, when the file says.
    //
    retries?: number;

    //
    // Whether to say more about what is being done, when the file says.
    //
    verbose?: boolean;
}

//
// Reads the settings file, filling in what it leaves out. A file that cannot be read gives the
// defaults, and a file that is not JSON gives no retries and says more, so the mistake is seen.
//
export async function readSettings(path: string): Promise<ISettings> {
    assert(typeof path === "string");
    try {
        const written: IWrittenSettings = JSON.parse(await fs.readFile(path, "utf8"));
        return {
            retries: written.retries ?? 3,
            verbose: written.verbose === true,
        };
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            return {
                retries: 0,
                verbose: true,
            };
        }
        return {
            retries: 3,
            verbose: false,
        };
    }
}
