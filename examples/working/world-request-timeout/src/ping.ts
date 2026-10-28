//
// Asking a service for an answer, giving up when it says nothing for too long.
//

import assert from "node:assert/strict";
import { request } from "node:http";

//
// Says in a word how the service at `port` on this machine answered: "answered", "timed out" when
// it said nothing for a second, or "failed" when the request or its answer failed another way.
//
export function ping(port: number): Promise<string> {
    assert(Number.isInteger(port));
    return new Promise((resolve) => {
        const sent = request({
            host: "127.0.0.1",
            port,
            path: "/",
            timeout: 1000,
        }, (answer) => {
            answer.resume();
            answer.on("end", () => {
                resolve("answered");
            });
            answer.on("error", () => {
                resolve("failed");
            });
        });
        sent.on("timeout", () => {
            sent.destroy();
            resolve("timed out");
        });
        sent.on("error", () => {
            resolve("failed");
        });
        sent.end();
    });
}
