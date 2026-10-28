# Fault testing a repository with Faultline (the quick version)

What a repository does to start using Faultline, in order. `USER-GUIDE.md` has the detail.

## 1. Add the dependency

```sh
npm install --save-dev github:ashleydavis/faultline-js
```

## 2. Have Node 24 or later

Node 24 or later is required. Faultline runs your code in Node, because V8 reports which code ran, whatever runtime your project uses in production. With an older Node, Faultline prints one sentence and exits 1.

## 3. Choose what Faultline tests

Faultline reads your `tsconfig.json` for your types and how your imports resolve, and tests every JavaScript and TypeScript file it finds except `node_modules`, directories starting with a dot, `dist`, `build`, `out` and `coverage` at the root, `.d.ts` files, test files and sim files. These keys in `faultline.config.yaml`, a YAML file at your project root, are there when you want them: `include` names the files and directories to fault test and `exclude` names the files and directories to leave out, both as lists of paths relative to your project root (see `USER-GUIDE.md` for examples). Any other key, or a file that is not valid YAML, is refused with a sentence and exit 1.

Use `exclude` for benchmarks and test harnesses. They are code, so Faultline takes them for source and asks you to cover their code paths too.

Options: `--file <path>` and `--function <name>` narrow Faultline to one file or one function, `--report <path>` moves the full checklist, `--replay "<token>"` reproduces a failure Faultline already reported and `--jobs <n>` sets how many workers run at once (by default one per processor core, and no more than the free memory holds at two gigabytes each).

## 4. Run Faultline

```sh
npx flt
```

Faultline exits 1 below 100% coverage and 0 at 100%.

Faultline keeps each file's result in `node_modules/.cache/faultline/` and does not execute again code that is unchanged since the run that proved it. The report says which files' results came from the cache. `npx flt --no-cache` executes every file, and `npx flt clear` throws the kept results and the compiled files away. A file that has not changed is not compiled again, even with `--no-cache`.

`npx flt --full-report` also prints a line for every function of every file.

Faultline keeps the replay token of every call that has crashed in `node_modules/.cache/faultline/crashes.txt` and answers them all at the start of every run, so a crash is never lost to a seed that does not reach it. Only a kept crash whose file has changed since its call was last made is replayed; the rest are answered from the results cache. `--no-cache` and `clear` leave them alone.

## 5. Read the report

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

Each checklist line carries a file, a line and one thing to do. With `--full-report`, a function is done when its line reads `ok`, which means every one of its code paths was exercised. `MISS isMagic 2/3 code paths` is 2 exercised out of 3. A crash is shown with the replay command that repeats it, such as `npx flt --replay "src/status.ts:statusOf;seed=357689237;fail=network#0/name-does-not-resolve"`. The report file named on the last line lists every code path, exercised or not, every failure and every thing to do, including those the terminal leaves out.

## 6. Write value factories for your own types that Faultline cannot instantiate

An exported function in the sim file that returns a value of one of those types. A type a package or a `.d.ts` file declares with properties of its own, such as a zod schema, is one of them unless it is a built-in type such as `Date` or `Map`. One that is only a call signature is built as a function. A parameter typed `object` gets values only from a value factory returning `object`. Faultline finds value factories by their return type and uses them only for the functions in the file beside the sim file. Put a factory several files need in `global.sim.ts`: Faultline uses its factories for every file. Write several, one per fault, to exercise the error handling. Faultline changes one parameter at a time from its first value and never two together, so a code path that needs two parameters changed at once needs a value factory or a scenario too.

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
```

## 7. Write a scenario for a code path Faultline cannot exercise

```ts
import type { ScenarioContext } from "faultline";
import { formatOf } from "./image.ts";

export function runPngHeaderScenario(context: ScenarioContext): void {
    const format = formatOf("PNG");
    context.expect(format === "png", "PNG to be read as the png format");
}
```

Copy the parameter exactly and export the function. Faultline recognises a scenario by its parameter, `ScenarioContext`. The function can have any name. The context holds `faults`, `programs`, `load`, `start` and `expect`.

## 8. Write an expectation function to check expectations after every call

```ts
import type { ExpectationContext } from "faultline";

export function rowsAndLinksAgree(context: ExpectationContext): void {
    context.expect(rowsMatchLinks(), "every row to have its link");
}
```

An expectation function runs after every call of a function in the matching source file and after every scenario in that sim file.

## Sim files

Value factories, scenarios and expectation functions go in a sim file beside the source: `image.sim.ts` for `image.ts`.

## How to write a value factory

- Re-exports are banned in `.sim.ts` files, including another sim file's value factory (`export { name } from "./other.sim.ts"`).
- A value factory that throws is reported as a failure ("The call to parseHeader was not made, because building its values failed with" its error), with a hint to make the factory return a value of its type.
- Value factories don't have side effects. If you find yourself adding side effects to value factories, such as writing files, it probably means you want a scenario.
- Build the value with the type's own constructor when it has one. Add a constructor only when building the value takes more than filling in its properties: an object literal that only sets properties stays an object literal.

## How to write a scenario

- When a value factory can exercise the code path, write the factory and not a scenario. A scenario is for a code path that needs the world laid out first, such as files written, before the call.
- Faultline runs a scenario once with no failure injected, then once for each failure at each place that run reached, as it does a call. With a failure injected, an expectation in the scenario that does not hold is not reported, because the failure is what changed the result. A crash or a hang still is.
- Once a type has a value factory in a sim file, Faultline uses only those factories for it in the functions of the file beside that sim file. Write one for every value it was exercised with before as well.
- Put the call on a line of its own and keep its result in a variable. Test the result in the expectation, rather than writing the call inside the condition.

## The loop to 100% coverage

Follow this loop from a first run to 100% coverage with no crash left.

1. Run `npx flt` and note the coverage line.
2. If the report shows a crash, fix it first: read its hint, run its replay command, fix the code, add a unit test for the fix, run the replay command again and check it passes. Fix crashes one at a time and go back to 1 after each.
3. Take one checklist item and write one value factory for it, or a scenario if no value factory can reach the code path.
4. Run `npx flt` again. Keep the change only if more code paths were exercised. Otherwise undo it and try another way.
5. Go back to 2 until Faultline exits 0.
