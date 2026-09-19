# Development

How to work with and contribute to this repo.

## Setup

Node 22.6 or later, because the tool and its tests are TypeScript that Node runs directly.

```sh
npm install
```

## Commands

- `npm run build` emits the JavaScript the package ships. A project being measured resolves `faultline` through the package's exports, which name what the build emitted, so the suites need it and run it for you.
- `npm test` runs the unit tests.
- `npm run typecheck` checks the types without emitting anything.
- `bash scripts/smoke.sh` runs flt against every example and compares what it printed with what was captured.
- `bash scripts/smoke.sh 01-one-function` runs one example.
- `bash scripts/smoke.sh --record` writes down what every example printed, for when a change to the report is meant.
- `bash scripts/test-everything.sh` runs both suites, and is what the pre commit hook runs.

Run `bash scripts/install-hooks.sh` in every fresh clone before committing.

## Running the browser example

One example runs its code in a real browser. It needs Playwright and a browser:

```sh
npx playwright install chromium
```

Where a machine already has one, `FAULTLINE_CHROMIUM` names it and no download is needed. Without either, `scripts/smoke.sh` says it skipped that example rather than failing.

## The examples

Every directory under `examples/` is a small project of its own, with its own `package.json` and its own link to the tool, exactly as a real project has.

`examples/working/` is one feature per directory and has to come back green. `examples/non-working/` is one failure per directory and has to come back red.

Each holds an `expected.txt`: everything the run printed, with the lines that move between runs taken out. Those are the work directory, the timings and the call counts. A change to a single line of the report shows up here before anybody reads it.

An example with a `run-flags.txt` is run with the flags in it. One without is run with `--seeds 16`. An example that has to exit with something other than 0 or 1 says so in a `status.txt`.

## How a run works

1. `src/discover/sources.ts` walks the tree and says which files are source, which are sim files and which were left out.
2. `src/build/program.ts` builds a TypeScript program over them, reading the project's own `tsconfig.json` where it has one. It reads the project through `node:fs`, the same way every other part of the tool does, so one thing decides what a file holds.
3. `src/discover/functions.ts` reads every function, every class and every factory and scenario, and `src/discover/recipes.ts` turns each parameter's type into a recipe for building values of it.
4. `src/discover/paths.ts` finds every code path and where each one sits in the text.
5. `src/drive/work.ts` does the driving: it loads the copies, builds values, calls every function, runs every scenario and checks every invariant. It touches nothing only Node has, so a browser loads it too.
6. `src/drive/child.ts` is the Node side of that, in a process of its own, reading what V8 counted through the inspector. `src/drive/browser.ts` and `src/drive/page.ts` are the browser side, answering the page's requests for the copies inside this process and reading what V8 counted there.
7. `src/drive/host.ts` watches the run, puts the counts back together, and starts the process again after a unit it was on if it stops saying anything.
8. `src/coverage/v8.ts` turns what V8 reported over the copy into a count at a place in your source, through the map the transpile wrote.
9. `src/report/` turns the counts into the per function lines, the list of things to do and the one number at the end.
