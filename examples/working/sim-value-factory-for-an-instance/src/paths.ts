//
// Where a program keeps its settings on each platform.
//

import assert from "node:assert/strict";

//
// The settings directory of one platform.
//
export class SettingsPlace {
    //
    // The platform the directory is for, as Node names it.
    //
    private readonly platform: string;

    constructor(platform: string) {
        assert(typeof platform === "string");
        this.platform = platform;
    }

    //
    // The directory, under `home`.
    //
    directory(home: string): string {
        assert(typeof home === "string");
        if (this.platform === "win32") {
            return `${home}\\AppData\\Roaming`;
        }
        if (this.platform === "darwin") {
            return `${home}/Library/Application Support`;
        }
        return `${home}/.config`;
    }
}
