//
// A health check that forgets a request can fail.
//

import assert from "node:assert/strict";

//
// Gives the status a service answers its health check with. When the request fails there is no
// answer, and reading its status anyway is the crash this example shows.
//
export async function statusOf(): Promise<number> {
    let answer: Response | undefined;
    try {
        answer = await fetch("https://example.com/health");
    }
    catch {
        answer = undefined;
    }
    assert(answer !== null);
    return answer!.status;
}
