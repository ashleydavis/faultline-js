//
// Where a command's lines go: the report and the replay to standard output, errors to standard
// error, and on a terminal a progress line that the next line printed takes the place of.
//

import assert from "node:assert/strict";

//
// What a command prints through, so a test reads every line it printed.
//
export interface IOutput {
    //
    // Prints one line of what the command found.
    //
    print(line: string): void;

    //
    // Prints one line saying why the command could not do what was asked.
    //
    printError(line: string): void;

    //
    // Shows where a run has got to, in place of the last progress line. It shows nothing when the
    // output is not a terminal, because a captured run would fill with them.
    //
    showProgress(line: string): void;
}

//
// A stream the console output writes to.
//
export interface IOutputStream {
    //
    // Writes text.
    //
    write(text: string): boolean;

    //
    // Whether the stream is a terminal, which Node leaves undefined when it is not.
    //
    isTTY?: boolean;
}

//
// What takes a terminal's cursor back to the start of the line and clears it, so the next line is
// written over a progress line.
//
export const wipeLine = "\r\x1b[2K";

//
// The output of the `flt` process: lines to its standard output and errors to its standard error.
// A progress line is wiped before the next line is written, so it never stays in the report.
//
export class ConsoleOutput implements IOutput {
    //
    // Where the report goes.
    //
    readonly out: IOutputStream;

    //
    // Where errors go.
    //
    readonly errors: IOutputStream;

    //
    // Whether a progress line is on the terminal now.
    //
    isProgressShowing = false;

    //
    // Writes the report to `streams.out` and errors to `streams.errors`.
    //
    constructor(streams: { out: IOutputStream; errors: IOutputStream }) {
        assert.notEqual(streams.out, streams.errors, "The report and the errors go to two streams, so an error never lands inside the report.");
        this.out = streams.out;
        this.errors = streams.errors;
    }

    //
    // Prints one line of the report, over the progress line when one is showing.
    //
    print(line: string): void {
        assert(!line.includes("\n"), "A line printed holds no line break of its own.");
        this.wipeProgress();
        this.out.write(`${line}\n`);
    }

    //
    // Prints one line of an error, over the progress line when one is showing.
    //
    printError(line: string): void {
        assert(!line.includes("\n"), "A line printed holds no line break of its own.");
        this.wipeProgress();
        this.errors.write(`${line}\n`);
    }

    //
    // Shows a progress line in place of the last, on a terminal only.
    //
    showProgress(line: string): void {
        assert(!line.includes("\n"), "A progress line holds no line break.");
        if (this.out.isTTY !== true) {
            return;
        }
        this.out.write(`${wipeLine}${line}`);
        this.isProgressShowing = true;
    }

    //
    // Clears the progress line, when one is showing, so the next line starts on a clean line.
    //
    wipeProgress(): void {
        if (!this.isProgressShowing) {
            return;
        }
        this.out.write(wipeLine);
        this.isProgressShowing = false;
    }
}
