//
// One settings place per platform the program runs on.
//

import { SettingsPlace } from "./paths.ts";

//
// Linux.
//
export function linuxPlace(): SettingsPlace {
    return new SettingsPlace("linux");
}

//
// macOS.
//
export function macPlace(): SettingsPlace {
    return new SettingsPlace("darwin");
}

//
// Windows.
//
export function windowsPlace(): SettingsPlace {
    return new SettingsPlace("win32");
}
