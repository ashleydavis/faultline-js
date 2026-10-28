//
// Starting an app on the port it is given.
//

import assert from "node:assert/strict";
import type { App } from "./app.js";

//
// Starts the app, and says in a sentence whether it is listening.
//
export function serve(app: App, port: number): string {
    assert(typeof port === "number");
    if (app.listen(port)) {
        return "Listening.";
    }
    return "The port is taken.";
}
