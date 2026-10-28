# Fault testing a repository with Faultline

Faultline calls every function in your repository with chosen inputs, injects failures at every call that could fail and reads which code ran from V8. It reports every code path that no call exercised.

## Step 1: Add the dependency

```sh
npm install --save-dev github:ashleydavis/faultline-js
```

That adds a command named `flt`.

## Step 2: Have Node 24 or later

Node 24 or later is required. V8, the engine inside Node, reports which code ran, so Faultline runs your code in Node whatever runtime your project uses in production. If Node is older, Faultline prints one sentence saying so and exits 1.

## Step 3: Choose what Faultline tests

Faultline reads your `tsconfig.json` for your types and for how your imports resolve, the way your editor does. Each file is read with the `tsconfig.json` that owns it.

The `declare global` and `declare module` blocks in the TypeScript files under a `tsconfig.json`'s directory hold in every file Faultline reads with that `tsconfig.json`, sim files included, as they do in your project's own build.

Your code imports a JSON file the way Bun and bundlers allow: an import without `with { type: "json" }` loads. Under `moduleResolution: bundler`, an import of a package's file that names no extension, such as `dayjs/plugin/timezone`, is found the way a bundler finds it, by trying `.js`, `.mjs`, `.cjs` and `/index.js` in turn.

Faultline looks through your project for JavaScript and TypeScript files and fault tests every one it finds. It leaves out `node_modules`, directories whose names start with a dot, `dist`, `build`, `out` and `coverage` at the project root, `.d.ts` files, test files (`.test.*` and `.spec.*`) and sim files. The keys in Faultline's configuration file change that.

### The configuration file: `faultline.config.yaml`

Faultline's settings live in a YAML file of their own, `faultline.config.yaml`, at the root of your project beside `package.json`, the way Jest's live in `jest.config.js`. A project with no configuration file, or an empty one, has every file found fault tested.

The file holds two keys, `include` and `exclude`, each a list of paths. Any other key is refused with a sentence naming it, so a misspelt key never quietly tests files you did not choose. A file that is not valid YAML is refused with a sentence giving the line and column of the problem. Either way Faultline exits 1 before it tests anything.

```yaml
include:
  - lib
exclude:
  - lib/bench
```

### `include`: name the files and directories to test

To test only some of your code, name it. `include` takes paths to files and directories, relative to your project root. This project keeps code under `lib/text` and `lib/io`, has one more file to test and has a `scripts` directory that should not be tested:

```
yourproject/
    faultline.config.yaml
    package.json
    main.ts
    lib/
        text/
            casing.ts
        io/
            reader.ts
    scripts/
        generate.ts
```

```yaml
include:
  - lib/text
  - lib/io
  - main.ts
```

Faultline tests only those paths. `scripts/generate.ts` is left alone. Naming `include` turns off Faultline's own search for files, so list everything you want tested.

### `exclude`: leave out files and directories

Benchmarks and test harnesses are code too, so Faultline takes them for source and asks you to cover their code paths. A benchmark exercises your code and is not code you want tested. `exclude` takes paths to files and directories, relative to your project root:

```
yourproject/
    faultline.config.yaml
    package.json
    sorting.ts
    bench/
        sorting-bench.ts
    tools/
        harness.ts
        helper.ts
```

```yaml
exclude:
  - bench
  - tools/harness.ts
```

This leaves out everything under `bench` and the one file `tools/harness.ts`. `tools/helper.ts` is still tested.

### Options

Type these after `npx flt` on the command line, for example `npx flt --file src/format.ts`:

- `--file <path>` and `--function <name>` narrow Faultline to one file or one function. The coverage percentage then covers only what you asked for. A run narrowed to a source file also runs the scenarios in the sim files that file uses: the one beside it and every `global.sim.ts`. It makes no calls of the functions in other files, so a code path that only those calls exercise is counted as not exercised.
- `--report <path>` moves the full checklist.
- `--replay "<token>"` reproduces a failure Faultline already reported.
- `--jobs <n>` sets how many workers run at once. By default there is one per processor core, and no more than the free memory holds at two gigabytes each, so a run never uses more memory than the machine has free. The report is the same whatever the number.
- `--full-report` prints a block for every source file with a line for every function: whether all its code paths were exercised, how many and how many calls were made. Without it the run prints the totals and the checklist only.
- `--no-cache` executes every file and keeps no results (see below).

## Step 4: Run Faultline

```sh
npx flt
```

Faultline prints a checklist of what you need to do have it exercise every code path. Faultline exits 1 below 100% and 0 at 100%.

### Results kept from earlier runs

Faultline does not execute again code an earlier run already proved and that is unchanged since. It keeps the complete result of every source file and sim file in `node_modules/.cache/faultline/`: every call's count, every failure and which code paths were exercised. A later run loads a file's result from the cache when that file, everything it imports, its sim file, every `global.sim.ts`, your lockfile and Faultline itself are all unchanged, and so is every file whose calls exercised its code paths. Every other file is executed, and so is every file whose calls exercised the code paths of a file that is executed. The report is the same as the run that made the result printed, so a run whose results all come from the cache returns in a moment.

The run says how many files' results it loaded, just before the time it took. This capture is from a run of a larger project whose results all came from the cache:

```
  Coverage: 6807 of 6807 code paths, 100%.

  Exercised 6807 code paths, 1151 functions, 132 files.
  Cached 137 source files, 109 sim files.
  Took 4s 110ms.
```

With `--full-report` (below), the block of each source file whose result came from the cache says so in its heading:

```
  src/magic.ts (from the cache)
    ok   (top level)                      1/1 code paths, 1 call
    MISS isMagic                          2/3 code paths, 5 calls
```

- `npx flt --no-cache` executes every file and keeps no results.
- `npx flt clear` throws away every kept result and every compiled file, so the next run compiles and executes every file. It runs no fault tests itself.
- Faultline also keeps what the TypeScript compiler worked out for each file in `node_modules/.cache/faultline/compiled/`, so a file that has not changed, and none of whose imports, compiler options, lockfile or Faultline code has changed, is not compiled again. `--no-cache` still uses it.
- A new version of Faultline executes every file on its first run, because the results kept by the version before it are not used.
- A run narrowed with `--file` or `--function` neither loads nor keeps results, because it makes fewer calls than a run of the whole project.

### Crashes kept from earlier runs

Each run picks its values from a new seed, so a call that crashed on one run may not be made on the next. Faultline keeps the replay token of every call that has crashed in `node_modules/.cache/faultline/crashes.txt` and replays every one of them at the start of every run, before any call of its own, whatever the run's seed. A kept crash that still fails is reported with the rest of the run's failures:

```
  Replayed 16 kept crashes, 0 still fail.
```

- A kept crash of a file that has not changed since its call was last made, judged as the results cache judges a file, is not replayed: its answer is kept with the file's result and the run takes it from there, and the line says how many were read from the cache:

```
  Read 16 kept crashes from the cache, 0 still fail.
```

- The crash shown first in the report is shown with the values its call was made with, taken from that call's answer, so it is not replayed for the report either.
- A token stays in the file after its crash is fixed, so the crash is found again if it comes back.
- A crash a run finds again with only a new seed is not added a second time, unless one of its values was drawn from the seed.
- A token that no longer names a call of your project, because its function is gone or its values can no longer be built, is dropped and the run says why.
- `npx flt --no-cache` and `npx flt clear` leave the kept crashes alone. Deleting `node_modules/.cache/faultline/` throws them away.
- A run narrowed with `--file` or `--function` replays only the kept crashes in what it was narrowed to, and keeps the rest.

## Step 5: Read the report

The report gives the checklist, the failures, the coverage and the totals. For each code path that was not exercised, it says what to do:

```
Fault testing the JavaScript and TypeScript source in branch-unreached.

  Read 1 source file, 2 functions.

  One thing to do:
    Write a value factory that reaches the true side of the if at src/magic.ts:13 in isMagic, or a scenario that exercises it if no value factory can.

  No call crashed, hung or found an expectation false.

  Coverage: 3 of 4 code paths, 75%.

  Exercised 3 code paths, 2 functions, 1 file.

  Every failure and every thing to do is in node_modules/.cache/faultline/report.txt.
```

With `--full-report` the report also has a block per source file and a line per function:

```
  src/magic.ts
    ok   (top level)                      1/1 code paths, 1 call
    MISS isMagic                          2/3 code paths, 5 calls
```

A function is done when its line reads `ok`, which means every one of its code paths was exercised. `MISS` means at least one was not, and `2/3` is 2 exercised out of 3. The code at the top level of a file is listed as `(top level)`.

The report file named on the last line holds one line per code path, failure, thing to do and file left out, including those the terminal leaves out:

```
exercised src/magic.ts:5 (top level):entered in (top level)
exercised src/magic.ts:11 isMagic:entered in isMagic
not exercised src/magic.ts:13 if:13:true in isMagic
exercised src/magic.ts:13 if:13:false in isMagic
to do Write a value factory that reaches the true side of the if at src/magic.ts:13 in isMagic, or a scenario that exercises it if no value factory can.
skipped node_modules, because it holds installed packages, not the project's own code.
```

A failure is two lines in the report file, `failed <kind>: <message>` and `  replay with npx flt --replay "<token>"`. A code path V8 cannot count is a `not provable` line (see "A limit of V8").

## How Faultline chooses what to call

Faultline's goal is to exercise every code path in every function. It asks V8 which code paths have been exercised so far and it keeps choosing input values and injecting failures until every code path has been exercised or it has run out of values and failures to try for the rest. A failure matters because the code that handles it is a code path too.

For each function, Faultline does the following, in order:

1. Faultline calls the function with the input values it picks (listed below). Every call shows the places where the function uses something that can fail: a file operation, a network call, a clock reading, a program it starts, a write or a function passed in to it.
2. For each place it has seen and each failure that can happen there, Faultline calls the function again and makes exactly that failure happen. `FAILURES.md` lists the failures. These calls can reach new places and Faultline does the same for them.
3. Faultline asks V8 which code paths have still not been exercised. For each one it reads the conditions in your source and calls the function again with values on each side of them.

Faultline calls private functions directly, as it calls exported ones. In the copy of your source that it loads for a run, every top-level function, class and constant is exported; your own files are not changed. A function declared inside the body of another function is the exception: code outside that function cannot name it, so it runs only when Faultline calls the function it is declared in.

The code at the top level of a file runs when the file is imported, so Faultline imports each file as a call of its own and injects failures at every place the top level reaches.

Faultline asks V8 every few calls, and at the end of every function, which code paths are exercised, so a function can be called a few times more than it needs, with failures injected in those calls as in any other. It stops calling a function once every one of that function's own code paths is exercised and so is every code path of the functions in the same file that Faultline does not call itself, because those are reached only through their callers.

Faultline gives up on a code path only when it has tried every value and every failure it has for that code path: the input values it picks, the values it reads from the conditions in your source and every failure at every place it can happen. A code path it gives up on becomes a checklist item asking for a scenario.

Faultline picks input values from the boundary values of each type (zero, one, minus one, a half, minus zero, the largest and smallest safe integers, `NaN` and both infinities, an empty array, a one element array, an empty string, a one character string, false and true, every member of a union, `null` and `undefined` where the type allows them), plus a few from a random number generator. Each run starts the generator from a new seed. A replay starts it from the seed of the run it replays, so the same values come up again. Faultline only passes a value your types allow.

Faultline calls each function with the first value it has for every parameter, then changes one parameter at a time to each of that parameter's other values, with the rest left at their first values: its own values and your value factories alike. It does not call every combination of values, because their number is the product of how many values each parameter has. A code path that only runs when two parameters change together is a checklist item: write a value factory or a scenario that reaches it.

Some parameters get values the way a caller would make them. An object gets each of its properties from the property's own type. A class is built with its constructor. A method is called on an instance built with the first value of each constructor parameter, or, when the sim file has value factories returning the class, on each instance they give. A function passed in returns a value of its return type, and Faultline also makes it throw, or reject when it returns a promise, as a failure at that place. A call that returns a promise is waited for, and its timers, `AbortSignal.timeout` included, run in simulated time, so a function that waits an hour is exercised at once. Once a call has returned, the timers it left behind still run, for up to a minute of simulated time, and a repeating one runs once more and is not set again.

## Step 6: Write value factories for your own types that Faultline cannot instantiate

Faultline instantiates numbers, bigints, strings, booleans, literals, unions, arrays, tuples, objects, interfaces, records, maps, sets, dates, URLs, byte arrays, errors, promises, functions and classes whose constructors take any of those. It also provides the filesystem, the network, the clock, random numbers and the terminal. For your own types that it cannot instantiate, you write a value factory.

A parameter typed `object` gets values only from a value factory returning `object`, because `object` names any value that is not a primitive and Faultline cannot tell which one your code needs.

A type that a package or a declaration file (`.d.ts`) declares under a name and that has properties of its own, such as a zod schema, a client from an SDK or an Express app, is one Faultline does not instantiate, apart from the built-in types above. Faultline does not read what such a type holds, because a library's types can go on without end, and the checklist asks for a value factory returning it. One factory serves every use of the type, whatever its type arguments. A library type that is a call signature and has no properties is built as a function, as a function type of your own is.

A value factory is an exported function in a sim file that returns a value of one of those types:

```ts
export function workingLoader(): ImageLoader {
    return {
        source: myTestBytes(),
    };
}
```

Faultline finds value factories by their return type, as the factory writes it. A factory returning a type alias your project declares, such as `type JsonObject = Readonly<Record<string, unknown>>`, serves every parameter written with that alias. A factory returning a built-in type such as `string`, `Date` or `unknown` serves every parameter of that type. Once a type has a value factory, the factories' values replace Faultline's own values for that type, wherever the type is held: a `Date` property of an object gets the factories' dates too. The sim file sits beside the file being tested: `image.sim.ts` for `image.ts`. A factory may take parameters and Faultline provides them.

Faultline uses a sim file's value factories only for the functions in the file beside it: the factories in `image.sim.ts` are used for the functions in `image.ts` and for no other file. When functions in several files take an `ImageLoader`, each of those files needs factories for it in its own sim file. This applies to every type a factory returns, including strings and numbers.

A value factory that several files need goes in a sim file named `global.sim.ts`. Faultline uses the factories in a `global.sim.ts` for the functions in every file. A string or number factory there reaches every function that takes a string or a number, so keep those in the sim file beside the file that needs them.

Write as many factories as you like for one of those types. A function that takes an `ImageLoader` is called with each of them.

To return a different value on each call, put the function on an exported class:

```ts
export class MyLoaders {

    //
    // Whatever state variables you want.
    //

    loader(): ImageLoader {
        //
        // Returns the next loader in whatever sequence you want.
        //
    }
}
```

Faultline finds it the same way, by the type the function returns.

### One factory per fault

Some branches run only when something goes wrong: a missing file, a response that will not parse. Write one factory per fault and Faultline calls your code with the working value and with each broken one:

```ts
export function workingLoader(): ImageLoader {
    return {
        source: myTestBytes(),
    };
}

export function missingFileLoader(): ImageLoader {
    return {
        source: myMissingFile(),
    };
}

export function truncatedFileLoader(): ImageLoader {
    return {
        source: myTruncatedBytes(),
    };
}
```

Faults in files, the network, the clock, other programs and the terminal need no factory. Faultline creates those automatically.

## Step 7: Write scenarios for code paths Faultline cannot exercise

Faultline reads the conditions in your source and tries values on each side of them. It cannot work out a value for a condition whose result has to be calculated, such as `if (checksum(data) === 0x1f2e)`, or for one that needs several arguments to line up. For those it asks for a scenario: a function in the sim file that calls your function with values you choose.

```ts
import type { ScenarioContext } from "faultline";
import { formatOf } from "./image.ts";

export function runPngHeaderScenario(context: ScenarioContext): void {
    const format = formatOf("PNG");

    context.expect(format === "png", "PNG to be read as the png format");
}
```

Faultline recognises a scenario by its parameter, `ScenarioContext`. The function can have any name and can be `async`.

The context gives a scenario:

- `context.faults`: the failures Faultline can inject, so a scenario can ask for one at a chosen place.
- `context.programs.answer(name, { stdout, stderr, exitCode })`: what a program your code runs with `node:child_process` prints and exits with, for the rest of the scenario. `name` is the program's file name, such as `ioreg`, or its full path. A program with no answer prints nothing and exits with code 0.
- `context.load(path)`: imports a file of your project afresh, running its top level again, for a file whose top level needs files written or environment variables set first. The path is relative to your project root, as in `include` and `exclude`.
- `context.start(path)`: imports a file afresh as the process's entry point, the way `node` starts a file, so `import.meta.main` is true for it for the rest of the scenario. The path is relative to your project root.
- `context.expect(condition, "what you expected")`: an expectation, as in a unit test. If the condition is false, the expectation fails and Faultline reports it.

Faultline replaces `node:fs`, `fetch`, the clock and the rest listed in `FAILURES.md` with simulated ones in memory for every file it loads, so a scenario writes files and sets environment variables the way your code does, and Faultline makes them fail as listed in `FAILURES.md`.

A scenario stands in for a service the same way: it starts a server with `node:http` and points your code at it on `127.0.0.1` or `localhost`. Every request your code makes there, with `fetch`, `node:http`, `node:https` or a package such as an SDK client, reaches that server and gets its answer. A server your own code starts, such as one waiting for a browser to come back to it, is reached the same way. A request's `timeout` and a socket's `setTimeout` run on the run's clock, so a request to a server that never answers ends at its timeout without the scenario waiting. Close the server when the scenario is done.

Faultline runs a scenario the way it calls a function: once with no failure injected, then once for each failure at each place that run reached. So a scenario that writes files and then calls your code exercises the code that handles each of those files failing, as a call does.

A scenario that throws or rejects has not failed. Your code throws when Faultline injects failures, so only a false expectation fails a scenario, and only in the run with no failure injected. With a failure injected, an expectation that does not hold is not reported, because the failure is what changed the result. A crash or a call that never returns is reported in any run.

## Step 8: Write expectation functions to check expectations after every call

An expectation function checks expectations after a call or after a scenario:

```ts
import type { ExpectationContext } from "faultline";

export function rowsAndLinksAgree(context: ExpectationContext): void {
    context.expect(rowsMatchLinks(), "every row to have its link");
}
```

Faultline recognises an expectation function by its parameter, `ExpectationContext`. The function can have any name. Expectation functions in `image.sim.ts` run:

- After every call Faultline makes to a function in `image.ts`, whatever input values and injected failure that call used.
- After every scenario in `image.sim.ts`.

When one fails, Faultline prints the function and call (or the scenario), your sentence, the line and the replay command.

## Adopting Faultline gradually

You do not have to reach 100% for the whole project at once. Use `include` to start with a small part of your code, reach 100% for that part, then add more. Start with a single file or a directory.

Start with one file in `faultline.config.yaml`:

```yaml
include:
  - lib/text/casing.ts
```

When `npx flt` exits 0 for that file, add the next file or a whole directory:

```yaml
include:
  - lib/text/casing.ts
  - lib/text/trim.ts
  - lib/io
```

Keep adding paths until everything is included. Then remove `include` and `npx flt` covers the whole project.

The coverage percentage and the exit code cover only what `include` names, so `npx flt` exits 0 at 100% of that part.

## Sim files

A `<name>.sim.ts` file holds the value factories, scenarios and expectation functions for `<name>.ts`:

```ts
import type { ExpectationContext, ScenarioContext } from "faultline";

export function myValueFactory(): SomeValue {
    // Returns a value to pass to your functions.
}

export function myScenario(context: ScenarioContext): void {
    // Calls your functions with specific values.
}

export function myExpectation(context: ExpectationContext): void {
    // Checks expectations after a call or a scenario.
}
```

## A limit of V8

V8 counts the blocks of code it runs. A short circuit (`&&`, `||`, `??` or `?.`) inside a loop's own condition is tested on every turn of the loop and has no block of its own, so no count can show which side ran. Faultline leaves such a code path out of the counts and out of the checklist, and the report file lists it as `not provable`. A parameter's default value has no block of its own either: V8 counts it as part of the function, so it would read as used on every call, and Faultline lists it as `not provable` in the same way.

When a side of a conditional (`a ? b : c`) or the right side of a short circuit holds an `await`, V8 counts the code after the expression as often as that side ran, up to the next block it counts on its own, such as the body of the next `if`. Code there that ran on every call can read as never run. Faultline lists a code path that V8 counts there, such as the false side of an `if` right after the expression, as `not provable`. Writing the two awaits as the sides of an `if` and `else` gives V8 a block for each, and the paths after it are counted again.

## When Faultline finds a failure

A call that throws or rejects has not failed, because that is how JavaScript reports an error. A call has failed when it crashed (the JavaScript engine raised a `TypeError`, `ReferenceError` or `RangeError` at a line of your source, such as reading a property of `undefined`), when it never returned, when it left an error that no code caught, or when an expectation did not hold. A call of `process.exit` has not failed either, because ending the process is how a program stops: the call ends where it calls `process.exit`, and the code paths it reached are counted. A file whose top level calls `process.exit` when it is loaded, as an entry point does when its settings are missing, has not failed to load; the rest of it is reached by a scenario that gives it what it needs and loads it with `context.load`.

A value factory that throws is a failure, because the function it builds a value for is never called. The report says "The call to parseHeader was not made, because building its values failed with" the factory's error, and its hint asks you to make the value factory return a value of its type.

Faultline prints what failed and the command that repeats it. For the first crash it shows where the crash happened, in the way Elm and Rust show an error: the file, line and column, the values the call was made with, the failure it injected, your code with a mark under the place, the stack trace from the `npx flt` command down to the crash and a hint for that kind of crash:

```
-- CRASH src/status.ts:20:20 -----------------------------------------------------------------------
The call to statusOf crashed with TypeError: Cannot read properties of undefined (reading 'status').

  Injected: the 1st network call failed with "Name does not resolve".

  20 |     return answer!.status;
     |                    ^

  Stack trace:
    at src/status.ts:20:20
    at npx flt

  Hint: This line reads a property of a value that was undefined or null. Check for it first, or make sure no caller can pass it.
Reproduce it with: npx flt --replay "src/status.ts:statusOf;seed=357689237;fail=network#0/name-does-not-resolve"

  1 call crashed, in 1 function.
```

Start from the hint, fix the code so it handles that input or that failure, and run the replay command again to check the crash is gone.

The token holds the call, the seed, the values chosen and the injected failure, written as `<file>:<function>;seed=<n>;values=<choices>;fail=<effect>#<occurrence>/<failure>`:

- `<file>:<function>` is the source file, relative to your project root, and the function as the report names it. A scenario's token names its sim file and the scenario.
- `seed=<n>` is the seed the run's random numbers started from.
- `values=<choices>` is one choice per parameter, separated by commas: a letter for where the value came from (`b` a boundary value, `s` a value drawn from the seed, `c` a value read from a condition in your source, `f` a value factory) and its index. It is left out for a call with no parameters and for a scenario.
- `fail=<effect>#<occurrence>/<failure>` is the injected failure: what the call used, which use of it counting from 0 and the failure from `FAILURES.md`. It is left out for a call with no failure injected.

Run the command and Faultline drives the same calls in the same order and gives the same answer, with no other option, environment or file.
