//
// The scenarios that stand in for a service that answers and one that never does.
//

import type { ScenarioContext } from "faultline";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ping } from "./ping.ts";

//
// Starts `server` on `port`, failing when it cannot listen, as when a failure is injected there.
//
function listenOn(server: Server, port: number): Promise<void> {
    return new Promise<void>((listening, refused) => {
        server.once("error", refused);
        server.listen(port, "127.0.0.1", () => {
            listening();
        });
    });
}

//
// A service that answers every request at once.
//
export async function askAnsweringService(context: ScenarioContext): Promise<void> {
    const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
        response.end("pong");
    });
    await listenOn(server, 8081);
    try {
        const answer = await ping(8081);
        context.expect(answer !== "timed out", "A service that answers not to time out.");
    }
    finally {
        server.close();
    }
}

//
// A service that takes every request and never answers, so the request's timeout runs out on the
// run's clock.
//
export async function askSilentService(context: ScenarioContext): Promise<void> {
    const server = createServer(() => undefined);
    await listenOn(server, 8082);
    try {
        const answer = await ping(8082);
        context.expect(answer !== "answered", "A service that never answers not to be answered.");
    }
    finally {
        server.close();
    }
}
