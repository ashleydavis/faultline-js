// The command line: reads what was asked for, runs it, and says what the process exits with.

import { readOptions, usage } from "./options.ts";
import { run, versionOf } from "./run.ts";

// The escape that clears the line the cursor is on, so the progress line is overwritten rather
// than scrolled past.
const clearLine = "\r[K";

// Runs the tool. It hands back what the process exits with rather than exiting itself, so a test
// can call it and read the answer.
export async function main(argv: string[], cwd: string): Promise<number> {
    let options;
    try {
        options = readOptions(argv, cwd);
    }
    catch (thrown) {
        // Reading the options throws an Error and throws nothing else, so its message is what there
        // is to print.
        process.stderr.write(`${(thrown as Error).message}\n`);
        return 2;
    }

    if (options.version) {
        process.stdout.write(`${versionOf()}\n`);
        return 0;
    }

    if (options.help) {
        process.stdout.write(usage);
        return 0;
    }

    const onTerminal = process.stdout.isTTY === true;
    let progressShowing = false;

    // Prints one line of the report, taking the progress line away first when one is showing.
    const say = (text = ""): void => {
        if (progressShowing) {
            process.stdout.write(clearLine);
            progressShowing = false;
        }
        process.stdout.write(`${text}\n`);
    };

    // Rewrites the progress line in place, so a long run says where it is without scrolling the
    // report off the screen. A run whose output is being collected prints no progress at all.
    const progress = (text = ""): void => {
        if (!onTerminal) {
            return;
        }
        process.stdout.write(`${clearLine}${text}`);
        progressShowing = true;
    };

    const result = await run(options, say, progress);
    return result.status;
}
