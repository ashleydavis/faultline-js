// What a run was asked for, read from the command line.

import path from "node:path";
import { parsePlan, type Plan } from "./model.ts";

// Everything one run was told.
export interface Options {
    // The directory to fault test.
    root: string;

    // The directories under the root to walk. Left empty, the walk takes the root itself.
    source: string[];

    // Names to leave out of the walk, each either a directory name or one file's path.
    exclude: string[];

    // Narrows the run to one file, named the way the report prints it.
    file?: string;

    // Narrows the run to one function, by the name the report prints.
    fn?: string;

    // How many seeds to sweep.
    seeds: number;

    // Where the full list goes.
    report?: string;

    // The one run to reproduce.
    replay?: Plan;

    // How long one unit may take before the run steps over it, in milliseconds.
    budget: number;

    // Whether every function gets a line, rather than only the ones with a path left.
    all: boolean;

    // Whether the code runs in a browser rather than in Node.
    browser: boolean;

    // Which browser to run, where the one Playwright installed is not the one wanted.
    chromium?: string;

    // Whether the run only prints what it was asked for and stops.
    help: boolean;

    // Whether the run only prints its version and stops.
    version: boolean;

}

// How many seeds a run sweeps when it is told none. Thirty two is enough for the values a run
// makes up to reach the ordinary branches of most functions, and short enough to sit through.
export const defaultSeeds = 32;

// How long one unit may take before the run steps over it. Five seconds is far longer than any
// call that returns takes, so anything past it is a loop that never ends rather than slow code.
export const defaultBudget = 5000;

// What the tool prints when it is run with no arguments.
export const usage = `flt runs every code path in every function in your project.

Usage:
  flt [directory] [options]

Options:
  --source <dir>      A directory to fault test. Give it more than once for more than one.
  --exclude <name>    A directory name, or one file's path, to leave out. Give it more than once.
  --file <path>       Fault test only this file.
  --function <name>   Fault test only this function.
  --seeds <count>     How many seeds to sweep. The default is ${defaultSeeds}.
  --report <path>     Where to write the full list of every path.
  --replay <plan>     Reproduce one run, from the plan a failing run printed.
  --budget <ms>       How long one unit may take before it is stepped over. The default is ${defaultBudget}.
  --all               Give every function a line, not only the ones with a path left.
  --browser           Run the code in a browser, for code that reaches for a document.
  --chromium <path>   Which browser to run, where Playwright's own is not the one wanted. The
                      environment variable FAULTLINE_CHROMIUM says the same thing.
  --help              Print this and stop.
  --version           Print the version and stop.

It exits 1 on anything under 100% of code paths, and 0 at 100%.
`;

// Reads the command line. It refuses anything it does not understand rather than running something
// other than what was asked for.
export function readOptions(argv: string[], cwd: string): Options {
    const options: Options = {
        root: cwd,
        source: [],
        exclude: [],
        seeds: defaultSeeds,
        budget: defaultBudget,
        all: false,
        browser: false,
        help: argv.length === 0,
        version: false,
    };
    let rootGiven = false;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]!;
        if (!argument.startsWith("--")) {
            if (rootGiven) {
                throw new Error(`The directory was given twice: "${argument}" came after another one.`);
            }
            options.root = path.resolve(cwd, argument);
            rootGiven = true;
            continue;
        }
        const split = argument.indexOf("=");
        const name = split < 0 ? argument : argument.slice(0, split);
        const inline = split < 0 ? undefined : argument.slice(split + 1);
        const value = (): string => {
            if (inline !== undefined) {
                return inline;
            }
            const next = argv[index + 1];
            if (next === undefined) {
                throw new Error(`The option ${name} takes a value, and none came after it.`);
            }
            index += 1;
            return next;
        };
        switch (name) {
            case "--source":
                options.source.push(value());
                break;
            case "--exclude":
                options.exclude.push(value());
                break;
            case "--file":
                options.file = value();
                break;
            case "--function":
                options.fn = value();
                break;
            case "--seeds": {
                const count = Number(value());
                if (!Number.isInteger(count) || count < 1) {
                    throw new Error("The option --seeds takes a whole number of one or more.");
                }
                options.seeds = count;
                break;
            }
            case "--report":
                options.report = path.resolve(cwd, value());
                break;
            case "--replay":
                options.replay = parsePlan(value());
                break;
            case "--budget": {
                const milliseconds = Number(value());
                if (!Number.isInteger(milliseconds) || milliseconds < 1) {
                    throw new Error("The option --budget takes a whole number of milliseconds.");
                }
                options.budget = milliseconds;
                break;
            }
            case "--all":
                options.all = true;
                break;
            case "--browser":
                options.browser = true;
                break;
            case "--chromium":
                options.chromium = value();
                break;
            case "--help":
                options.help = true;
                break;
            case "--version":
                options.version = true;
                break;
            default:
                throw new Error(`There is no option called ${name}. Run flt --help to see the ones there are.`);
        }
    }

    return options;
}

// The seeds a run sweeps. They are the whole numbers from one, so a plan naming a seed reads as
// the number somebody sees in the report.
export function seedsFor(options: Options): number[] {
    if (options.replay !== undefined) {
        return [options.replay.seed];
    }
    const out: number[] = [];
    for (let seed = 1; seed <= options.seeds; seed += 1) {
        out.push(seed);
    }
    return out;
}
