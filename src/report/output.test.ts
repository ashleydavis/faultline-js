//
// Tests the console output. Goal: the report goes to standard output and errors to standard error,
// a line at a time; a progress line is shown only on a terminal and is wiped before the next line,
// so it never stays in the report. Method: give `ConsoleOutput` two streams that keep what is
// written to them, one claiming to be a terminal and one not.
//

import assert from "node:assert/strict";
import { describe, test } from "@jest/globals";
import { ConsoleOutput, wipeLine, type IOutputStream } from "./output.ts";

//
// A stream that keeps everything written to it.
//
export class KeptStream implements IOutputStream {
    //
    // Every piece of text written, in order.
    //
    written: string[] = [];

    //
    // Whether it says it is a terminal.
    //
    isTTY: boolean;

    //
    // Makes a stream that says it is a terminal when `isTerminal` is true.
    //
    constructor(isTerminal: boolean) {
        this.isTTY = isTerminal;
    }

    //
    // Keeps `text`.
    //
    write(text: string): boolean {
        this.written.push(text);
        return true;
    }
}

describe("ConsoleOutput", () => {
    test("a line of the report goes to standard output and an error to standard error", () => {
        const out = new KeptStream(false);
        const errors = new KeptStream(false);
        const output = new ConsoleOutput({
            out,
            errors,
        });
        output.print("  Took 1ms.");
        output.printError("The option is wrong.");
        assert.deepEqual(out.written, ["  Took 1ms.\n"]);
        assert.deepEqual(errors.written, ["The option is wrong.\n"]);
    });

    test("off a terminal, no progress line is shown", () => {
        const out = new KeptStream(false);
        const output = new ConsoleOutput({
            out,
            errors: new KeptStream(false),
        });
        output.showProgress("  Exercised 1 call in 0s, now in src/a.ts f.");
        output.print("done");
        assert.deepEqual(out.written, ["done\n"]);
    });

    test("on a terminal, a progress line replaces the last and is wiped before the next line", () => {
        const out = new KeptStream(true);
        const errors = new KeptStream(false);
        const output = new ConsoleOutput({
            out,
            errors,
        });
        output.showProgress("one");
        output.showProgress("two");
        output.print("report");
        output.print("more");
        output.showProgress("three");
        output.printError("error");
        assert.deepEqual(out.written, [`${wipeLine}one`, `${wipeLine}two`, wipeLine, "report\n", "more\n", `${wipeLine}three`, wipeLine]);
        assert.deepEqual(errors.written, ["error\n"]);
        assert.equal(output.isProgressShowing, false);
    });

    test("a line holding a line break is a mistake in whoever printed it", () => {
        const output = new ConsoleOutput({
            out: new KeptStream(true),
            errors: new KeptStream(false),
        });
        assert.throws(() => output.print("a\nb"), assert.AssertionError);
        assert.throws(() => output.printError("a\nb"), assert.AssertionError);
        assert.throws(() => output.showProgress("a\nb"), assert.AssertionError);
    });
});
