# Fault testing a repository with Faultline (the quick version)

What a repository has to do to start using the tool, in the order it is done.

## 1. Add the dependency

```sh
npm install --save-dev github:ashleydavis/faultline-js
```

Faultline reads which blocks ran from V8, which counts them itself. There is nothing to install for that.

Your files have to be modules: `"type": "module"` in your `package.json`, or files named `.mjs`. Faultline needs Node 22.6 or later.

## 2. Run it

```sh
npx flt
```

Faultline finds your files, transpiles them, calls every function it can and exercises every code path it can reach. It exits 1 on anything under 100% coverage and 0 at 100%.

`--source <dir>` names the directories to fault test and `--exclude <name>` names directory names, or one file's path, to leave out.

Use `--exclude` for your benchmarks and your test harnesses. They are code, so the walk takes them for source and asks you to cover their paths too. Use it as well for a file whose functions start a run of their own, because calling one runs your whole tool again.

Options: `--file <path>` and `--function <name>` narrow a run to one file or one function, `--report <path>` moves the full checklist, `--seeds <count>` changes how many seeds are swept, `--budget <ms>` changes how long one unit may take, and `--replay "<plan>"` reproduces one failure a run already reported.

Everything a run generates goes in the system's temporary directory, so there is no gitignore entry to add.

## 2a. Whatever kind of project it is

Faultline runs the code in Node whichever runtime a project targets, and reads your `tsconfig.json` where you have one, so a path alias resolves the way it does in your editor. A stylesheet, an image or anything else a bundler turns into an asset stands in as an empty module.

`examples/working` has one of each: `24-node-project`, `25-vite-project`, `26-bun-project` and `23-browser`.

## 3. Run browser code in a browser

A function that reads `document`, `window` or an element has nowhere to run in Node.

```sh
npm install --save-dev playwright
npx playwright install chromium
npx flt --browser
```

That serves your files to a real page and calls them there. What V8 counts in a browser is what it counts in Node, so the report reads the same either way. `--chromium <path>` names a browser where Playwright's own is not the one wanted, and `FAULTLINE_CHROMIUM` says the same thing.

## 4. Read the report

One line per function, one group per file, then what is left to do, then one number:

```
  sizing.ts
    MISS isLarge                        2/3 paths, 120 calls

  FAIL 1 code path that no call reached:
      sizing.ts:9 "if:9:true" in isLarge: no call the run made up reached it.

  One thing to do:
    Write a scenario reaching the true side of the if at sizing.ts:9 in isLarge. No call the run made up got there.

  Coverage: 2 of 3 paths, 66%.
```

A function is done when its line reads `ok` and the two numbers match.

Work the checklist from the top. Each line carries the file, the line and the one thing to do there.

The report file named on the `Full detail` line lists every branch, ticked or not, with its file and line.

## 5. Annotate nothing

There is no annotation to write and no `Log` to pass. V8 counts every block it runs and Faultline reads that, so a branch is seen without anything being written into your code.

What Faultline counts as a code path:

- The body of every function, including every method, getter, setter and constructor.
- Both sides of every `if`, whether or not an `else` was written.
- Both sides of every conditional.
- Both sides of `&&`, `||` and `??`.
- Every `switch` arm.
- The body of every loop.
- Every `catch`.
- Every default a parameter carries.

Two it leaves out and says so: a `try` whose body throws every time, because every byte of such a function runs and V8 is right that it is covered; and the skipped side of `&&` inside a loop's own condition, because a condition tested once per turn sits in the block around the loop and there is no count to take it from.

## 6. Write a test input factory for a type Faultline cannot build

Faultline builds every ordinary value from its type, and everything standard as well: strings, numbers, unions, arrays, objects, maps, dates, promises, classes and generics. What your code reaches the machine through is replaced rather than built, so `fs.readFileSync`, `fetch`, `Date.now`, `Math.random` and the rest are the run's own wherever your code calls them.

It cannot build a type whose value decides which branch runs. A test input factory is an exported function returning your type, and the return type is how Faultline finds it:

```ts
export function imageLoader(): ImageLoader {
    return { load: () => myTestBytes() };
}
```

Write as many as you like for one type and Faultline uses all of them, and the values it builds on its own stay in the turn beside them. Write one per fault to exercise the error handling paths in the code that uses it:

```ts
export function missingFileLoader(): ImageLoader {
    return { load: () => { throw new Error("ENOENT"); } };
}

export function truncatedFileLoader(): ImageLoader {
    return { load: () => myTruncatedBytes() };
}
```

To hand back a different value on each call, put the factory on an exported class as a method:

```ts
export class MyLoaders {

    //
    // Whatever state you want.
    //

    next(): ImageLoader {
        //
        // Returns the next loader in whatever sequence you want.
        //
    }
}
```

## 7. Write scenarios for hard to reach paths

Faultline reads the values your file's own comparisons test against and passes those in, so a branch turning on a value written in your file is reached without a scenario. A scenario is for a branch turning on a value your file never names, one worked out while the code runs, or one needing several arguments to line up at once.

```ts
import type { Checklist, Injector } from "faultline";
import { formatOf } from "./image.ts";

export function runPngHeaderScenario(injector: Injector, checklist: Checklist): void {
    void checklist;
    void injector;

    if (formatOf({ load: () => "PNG" }) !== "png") {
        throw new Error("WrongFormat");
    }
}
```

Copy those two parameters exactly and export the function: Faultline finds a scenario by its parameter types, never by its name.

Throw any error when the answer is wrong, and Faultline stops and prints the command that reproduces it.

A scenario runs against effects that answer. To reach the code that handles one going wrong, ask the injector for it by name: `injector.fail("net", "refused")`.

## 8. Write invariants for what has to keep holding

An invariant is checked after every call the run makes and after every scenario. Faultline finds one by its taking nothing and giving nothing back, where a scenario takes the injector.

```ts
import { theLedger } from "./ledger.ts";

export function theBalanceIsNeverNegative(): void {
    if (theLedger.balance < 0) {
        throw new Error("TheBalanceWentNegative");
    }
}
```

## Sim files

Test input factories, scenarios and invariants all go in a sim file: `image.ts` gets `image.sim.ts` beside it. You create the file, and Faultline finds it by its name.
