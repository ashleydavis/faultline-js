# Fault testing a repository with Faultline (full guide)

Faultline exercises every code path in every function in your repository. This is a guide to help you get up and running with Faultline.

## Step 1: Add Faultline to your project

Faultline is fetched from its repository. Install it:

```sh
npm install --save-dev github:ashleydavis/faultline-js
```

That gives you a command named `flt`.

Your files have to be modules: `"type": "module"` in your `package.json`, or files named `.mjs`. Faultline reads your `tsconfig.json` where you have one, so it sees the same types your editor does.

### Nothing to install for coverage

Faultline reads which blocks of your code ran from V8, the engine that runs it. V8 counts every block it runs, whether that is Node or a browser, and Faultline reads that count and maps it back to your lines. That is how it knows a branch ran without you writing anything into it.

## Step 2: Run it

```sh
npx flt
```

Faultline finds your files, transpiles them, calls every function it can and exercises every code path it can reach.

It prints a checklist of the things you must do to reach 100% code coverage.

It exits 1 on anything under 100% and 0 at 100%. This is by design to use it you need to get the 100% coverage and stay there (don't worry, Claude will help you get there quickly).

### What kind of project it is

Faultline runs the code in Node whichever runtime a project targets, and reads the `tsconfig.json` where there is one.

- An ordinary Node project, with a `src` directory: `examples/working/24-node-project`.
- A project built with a bundler, with `.tsx`, a path alias and a stylesheet import: `examples/working/25-vite-project`. A stylesheet, an image or anything else a bundler turns into an asset stands in as an empty module.
- A project laid out for Bun: `examples/working/26-bun-project`. A function calling Bun's own globals needs a test input factory standing in for what it reaches, the same as any other type Faultline cannot build.
- Code that reads a document: `examples/working/23-browser`, run with `--browser`.

### Code written for a browser

A function that reads `document`, `window` or an element has nowhere to run in Node, so it is never called and none of its paths run.

```sh
npm install --save-dev playwright
npx playwright install chromium
npx flt --browser
```

That serves your files to a real page and calls them there. Scenarios run in the page too, so one can set a title or put an element on the document before it calls your code.

## Step 3: Read the report

At the end Faultline prints a block per file and a line per function:

```
  packages/example/src/format.ts
    ok   formatFileSize                  9/9 paths, 120 calls

  packages/example/src/wrapped_error.ts
    ok   formatErrorChain                5/5 paths, 307 calls
```

Your function is done when its line reads `ok` and the two numbers match.

When a code path can't be reached, Faultline tells you what to do to fix it:

```
  FAIL 1 code path that no call reached:
      sizing.ts:9 "if:9:true" in isLarge: no call the run made up reached it.

  One thing to do:
    Write a scenario reaching the true side of the if at sizing.ts:9 in isLarge. No call the run made up got there.
```

The output of Faultline is a checklist you can work through to achieve 100% test coverage of your code.

## Step 4: Annotate nothing

There is no annotation to write and no `Log` to pass. V8 counts the blocks it runs and Faultline reads that, so your code says nothing about itself.

What Faultline counts as a code path:

- **The body of every function**, including every method, getter, setter and constructor.
- **Both sides of every `if`.** An `else` needs nothing, whether or not it has a body: Faultline counts how often the `if` itself ran against how often the true side did, and an `if` reached more often than its true side is one that took the other way.
- **Both sides of every conditional**, and both sides of `&&`, `||` and `??`.
- **Every `switch` arm.** An arm with no statement of its own falls through, so the next arm's path is what says either ran.
- **The body of every loop.**
- **Every `catch`**, and **every default a parameter carries**.

A callback written inside another function gets no line of its own: its paths belong to the function that wrote it, which is the function somebody has to go and change.

Two branches Faultline leaves out of the count, and says how many:

- A `try` whose body throws every time. Every byte of such a function runs, so V8 reports it covered and it is. Use a scenario or an invariant to say the other way has to happen.
- The skipped side of `&&` inside a loop's own condition. A condition tested once per turn of a loop sits in the block around the loop, so there is no count to take it from.

## Step 5: Create test input factories for your types

Faultline automatically instantiates parameters where possible.

It can handle ordinary values like strings, numbers, booleans, bigints, literals, unions, optionals, arrays, tuples, objects, interfaces, records, maps, sets, dates, regular expressions, URLs, byte arrays, errors, promises, functions, classes and generics.

It can handle the effects your code reaches for: the clock, the network, the file system, a writer, a source of randomness, an abort signal.

It injects failures: the file system it hands you fails with `ENOENT`, `EACCES`, `EIO`, `EISDIR` and `ENOSPC` in turn, the network refuses connections, times out, resolves no name and answers with a body that will not parse, the writer sometimes takes one character of what it was given, and the clock goes backwards and jumps forward. A function it passes in throws and rejects, and an argument arrives as `null` or `undefined` whatever its type said.

Faultline cannot instantiate a type whose value decides which branch runs. So you must provide one or more "test input factory" for each of those.

### A plain test input factory function

A test input factory is an ordinary exported function returning an instance of your type:

```ts
// Draws from this run's own seeded source.
export function randomGenerator(): RandomGenerator {
    return { random: myRandomNumber() };
}
```

Faultline finds a test input factory function by its return type.

Put the test input factory in a sim file, which you create next to the file being tested. For example if you are testing functions in `image.ts`, create a file `image.sim.ts`. Faultline automatically finds your sim files to find your test input factories.

A test input factory may take parameters and Faultline provides them automatically.

### One factory, many different values

A plain test input factory function provides one value. To hand back a different value each time, put the function on an exported class instead:

```ts
export class MyValueCreator {

    //
    // Whatever state variables you want.
    //

    generator(): RandomGenerator {
        //
        // Returns the next value in whatever
        // sequence you want.
        //
    }
}
```

Faultline finds it the same way as a plain function, by the type the function returns.

### As many test input factories as you want

You can write many test input factories for a type and Faultline uses all of them to instantiate values to pass as parameters to your functions. The values it builds from the type itself stay in the turn beside them, so writing a factory adds a value and never takes one away.

```ts
// One that always gives the same value.
export function fixedGenerator(): RandomGenerator {
    return { random: 7 };
}

// One that gives a different value every time.
export function changingGenerator(): RandomGenerator {
    return { random: myRandomNumber() };
}

// One that walks a sequence of your own.
export class MyValueCreator {

    //
    // Whatever state you want.
    //

    generator(): RandomGenerator {
        //
        // Returns the next value in whatever
        // sequence you want.
        //
    }
}
```

Each of your functions taking a `RandomGenerator` parameter is called with each of them.

### Fault injection

Your code has branches that only run when something goes wrong: a connection refused, a response that will not parse, a value at the end of its range. An ordinary call never reaches them, so they stay unticked.

Write a test input factory per fault. Faultline uses every one of them, so your code is called against a working value and against each broken one in turn.

```ts
// A loader that works.
export function workingLoader(): ImageLoader {
    return { load: () => myTestBytes() };
}

// One whose file is not there.
export function missingFileLoader(): ImageLoader {
    return { load: () => { throw new Error("ENOENT"); } };
}

// One whose file stops halfway.
export function truncatedFileLoader(): ImageLoader {
    return { load: () => myTruncatedBytes() };
}

// One whose file is not an image at all.
export function notAnImageLoader(): ImageLoader {
    return { load: () => myTextBytes() };
}
```

## Step 6: Write scenarios for hard to reach paths

Faultline makes up argument values from their types, so it will not reach a branch that only runs for one particular value, like the text `"PNG"` below.

The answer: write a scenario, a function that calls yours with that value (Claude can do this for you).

```ts
import type { Checklist, Injector, Subject } from "faultline";
import { formatOf } from "./image.ts";

//
// Faultline finds a scenario by its three parameters.
// Faultline doesn't care about the function name, just choose a name that's meaningful to you.
//
export function runPngHeaderScenario(self: Subject, injector: Injector, checklist: Checklist): void {

    //
    // Faultline hands these to every scenario. Most scenarios use neither:
    // the injector is what makes effects fail, and the checklist is what
    // Faultline ticks as paths run. Discard them and call your code.
    //
    void checklist;
    void injector;

    //
    // Runs the code under test directly passing in "PNG" as an input.
    //
    if (formatOf({ load: () => "PNG" }) !== "png") {
        //
        // Throwing here fails the Faultline test run.
        // You can throw any error you like.
        //
        throw new Error("WrongFormat");
    }
}
```

Scenarios go in the `<module>.sim.ts` file next to the module being tested.

Throw an error of your own to fail the scenario and have it reported by Faultline.

A scenario runs against effects that answer, so nothing fails underneath it unless it asks. To reach the code that handles an effect going wrong, ask the injector for it by name:

```ts
injector.fail("net", "refused");
```

The failures you can ask for are `refused`, `timeout`, `dns`, `server-error` and `bad-body` on `net`; `missing`, `denied`, `io`, `is-directory` and `full` on `files`; `short`, `closed` and `broken-pipe` on `writer`; and `backwards` and `jump` on `clock`.

## Step 7: Write invariants for what has to keep holding

A scenario says one thing is true after one sequence of calls. An invariant says something is true after every call Faultline makes, whatever it called and with whatever it made up.

Faultline finds an invariant by its one parameter, where a scenario has three.

```ts
import type { Subject } from "faultline";
import { theLedger } from "./ledger.ts";

export function theBalanceIsNeverNegative(self: Subject): void {
    void self;

    if (theLedger.balance < 0) {
        throw new Error("TheBalanceWentNegative");
    }
}
```

Faultline stops at the call that broke it and prints the command that reproduces it.

Invariants go in the `<module>.sim.ts` file too.

## Sim files

A `<module>.sim.ts` sim file (e.g. `image.sim.ts` for `image.ts`) is where you put your test input factories, scenarios and invariants.

## When Faultline finds a failure

Faultline prints what failed and the command that runs it again:

```
Seed 17 failed in image.sim.ts:8 runPngHeaderScenario with Error: WrongFormat.
Reproduce it with: flt --replay "seed=17"
```

To replicate the failure, copy that command and run it:

```sh
npx flt --replay "seed=17"
```
