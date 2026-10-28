//
// A stand-in for the service, which answers its health check one way and then another.
//

import type { ScenarioContext } from "faultline";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readHealth } from "./health.ts";

//
// Asks a stand-in service for its health twice: it answers "ok", then "busy".
//
export async function askStandIn(context: ScenarioContext): Promise<void> {
    const statuses = ["ok", "busy"];
    let asked = 0;
    const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
            status: statuses[Math.min(asked, statuses.length - 1)],
        }));
        asked += 1;
    });
    await new Promise<void>((listening, refused) => {
        server.once("error", refused);
        server.listen(8080, "127.0.0.1", () => {
            listening();
        });
    });
    try {
        const first = await readHealth("http://127.0.0.1:8080");
        const second = await readHealth("http://127.0.0.1:8080");
        context.expect(first === "healthy", "an ok status to read as healthy");
        context.expect(second === "degraded", "any other status to read as degraded");
    }
    finally {
        server.close();
    }
}
