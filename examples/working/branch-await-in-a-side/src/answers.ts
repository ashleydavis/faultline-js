//
// Reading an answer from whichever reader a question uses.
//

import assert from "node:assert/strict";

//
// Reads the answer from the chooser when the question has choices and from the typist when it does
// not, and says whether the person gave up.
//
export async function readAnswer(hasChoices: boolean, choose: () => Promise<string>, type: () => Promise<string>): Promise<string> {
    assert(typeof hasChoices === "boolean");
    const answer = hasChoices ? await choose() : await type();
    if (answer === "") {
        return "gave up";
    }
    return `answered ${answer}`;
}
