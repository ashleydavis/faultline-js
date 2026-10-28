//
// Asking a service whether it is healthy.
//

import assert from "node:assert/strict";

//
// Says in a word what the service at `baseUrl` answers its health check with: "healthy",
// "degraded" for any other status it names, or "unreachable" when it answers with no status.
//
export async function readHealth(baseUrl: string): Promise<string> {
    assert(typeof baseUrl === "string");
    let answer: Response;
    try {
        answer = await fetch(`${baseUrl}/health`);
    }
    catch {
        return "unreachable";
    }
    const body: unknown = await answer.json().catch(() => undefined);
    if (typeof body !== "object" || body === null || !("status" in body)) {
        return "unreachable";
    }
    if (body.status === "ok") {
        return "healthy";
    }
    return "degraded";
}
