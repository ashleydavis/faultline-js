//
// Waiting for a message no code sends.
//

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

//
// Where messages would arrive. No code emits on it.
//
const INBOX = new EventEmitter();

//
// Gives the next message to arrive in the inbox.
//
export function nextMessage(): Promise<string> {
    assert(INBOX.listenerCount("message") >= 0);
    return new Promise((settle) => {
        INBOX.once("message", settle);
    });
}
