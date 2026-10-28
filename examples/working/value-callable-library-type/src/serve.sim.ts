//
// Apps for the functions in serve.ts: one that can listen and one whose port is taken.
//

import type { App } from "./app.js";

//
// Builds an app whose `listen` answers `listening`.
//
export function buildApp(listening: boolean): App {
    const answer = (request: string): void => {
        console.log(request);
    };
    return Object.assign(answer, {
        listen: (port: number): boolean => port >= 0 ? listening : false,
    });
}

//
// An app that can listen.
//
export function freeApp(): App {
    return buildApp(true);
}

//
// An app whose port is taken.
//
export function takenApp(): App {
    return buildApp(false);
}
