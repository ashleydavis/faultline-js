# The output of a run

Every run below is a real capture, taken from the example named beside it. `bash scripts/smoke.sh` runs each of them and compares what came back against these same captures, so the page stays true to what the tool prints.

The lines that differ between two runs of the same example are taken out: the directory the run generated its work in, how long it took, and the per function call counts. `<work>` stands for that directory.

Every run ends with one number: the percentage of code paths that ran. The exit code is zero only when that reads 100%.

## A run with nothing left to do

Captured from `examples/working/09-factory`. Every path ran, so the last line reads 100% and the run exits zero.

```sh
$ flt .
```

```
Fault testing the JavaScript and TypeScript in 09-factory.

Deterministic simulation of 1 project. The report comes at the end.
  Read 1 source file, with 1 function to exercise.
  Exercising 16 units, scenarios first.
  Reading what those calls reached.

Deterministic simulation

  1 function covered every path, and is not listed above.

  Found 1 source file, tested 1, exercised 1 function and executed 5 of 5 paths.
  One seed ran against effects that answered, and 15 against a network that refuses connections, a file system that fails, a writer that takes only part of what it was given and a clock that jumps, one call in 4.
  Stepped over <count> calls for throwing on an input the function was never written for. The paths they would have covered are not in the count above.
  Swept 16 seeds, with no scenario reporting a wrong answer.
  Full detail is in <work>/coverage-report.txt.

  Coverage: 5 of 5 paths, 100%.

  Passed: every code path ran.
  Took <time>.
```

Exit code: 0.

## A run in a browser

Captured from `examples/working/23-browser`. The code reads a document, so it is called in a real page. What V8 counts there is what it counts in Node.

```sh
$ flt . --browser --seeds 4
```

```
Fault testing the JavaScript and TypeScript in 23-browser in a browser.

Deterministic simulation of 1 project. The report comes at the end.
  Read 1 source file, with 2 functions to exercise.
  Exercising 16 units, scenarios first.
  Reading what those calls reached.

Deterministic simulation

  2 functions covered every path, and are not listed above.

  Found 1 source file, tested 1, exercised 2 functions and executed 6 of 6 paths.
  One seed ran against effects that answered, and 3 against a network that refuses connections, a file system that fails, a writer that takes only part of what it was given and a clock that jumps, one call in 4.
  Swept 4 seeds, with no scenario reporting a wrong answer.
  Full detail is in <work>/coverage-report.txt.

  Coverage: 6 of 6 paths, 100%.

  Passed: every code path ran.
  Took <time>.
```

Exit code: 0.

## A run that went back for what it missed

Captured from `examples/working/22-exploration`. The first round left a path unreached. The second drove only the function it was in, reaching every place its effects could fail.

```sh
$ flt . --seeds 2
```

```
Fault testing the JavaScript and TypeScript in 22-exploration.

Deterministic simulation of 1 project. The report comes at the end.
  Read 1 source file, with 1 function to exercise.
  Exercising 2 units, scenarios first.
  Reading what those calls reached.

Deterministic simulation

  1 function covered every path, and is not listed above.

  Found 1 source file, tested 1, exercised 1 function and executed 4 of 4 paths.
  One seed ran against effects that answered, and 1 against a network that refuses connections, a file system that fails, a writer that takes only part of what it was given and a clock that jumps, one call in 4.
  Swept 2 seeds, with no scenario reporting a wrong answer.
  Drove 2 rounds, each one after the first exploring only the functions with a path left.
  Full detail is in <work>/coverage-report.txt.

  Coverage: 4 of 4 paths, 100%.

  Passed: every code path ran.
  Took <time>.
```

Exit code: 0.

## A run with a branch no call reached

Captured from `examples/non-working/20-unreached-branch`. A branch that only runs for one particular value. The list says where it is and what to write.

```sh
$ flt .
```

```
Fault testing the JavaScript and TypeScript in 20-unreached-branch.

Deterministic simulation of 1 project. The report comes at the end.
  Read 1 source file, with 1 function to exercise.
  Exercising 16 units, scenarios first.
  Reading what those calls reached.

Deterministic simulation

  magic.ts
    MISS isMagic                            2/3 paths, <calls> calls

  Found 1 source file, tested 1, exercised 1 function and executed 2 of 3 paths.
  One seed ran against effects that answered, and 15 against a network that refuses connections, a file system that fails, a writer that takes only part of what it was given and a clock that jumps, one call in 4.
  Swept 16 seeds, with no scenario reporting a wrong answer.
  Drove 3 rounds, each one after the first exploring only the functions with a path left.
  Full detail is in <work>/coverage-report.txt.

  FAIL 1 code path that no call reached:
      magic.ts:4 "if:4:true" in isMagic: no call the run made up reached it.

  One thing to do:
    Write a scenario reaching the true side of the if at magic.ts:4 in isMagic. No call the run made up got there.

  Coverage: 2 of 3 paths, 66%.

  Failed: 1 code path of 3 was never reached.
  The list above says what to do about each one.
  Took <time>.
```

Exit code: 1.

## A run where a function never returns

Captured from `examples/non-working/22-never-returns`. A loop with no end. The run stops it at the budget, carries on with everything else, and names the function.

```sh
$ flt . --budget 700 --seeds 4
```

```
Fault testing the JavaScript and TypeScript in 22-never-returns.

Deterministic simulation of 1 project. The report comes at the end.
  Read 1 source file, with 1 function to exercise.
  Exercising 4 units, scenarios first.
  Reading what those calls reached.

Deterministic simulation

  spin.ts
    MISS spin                               1/2 paths, <calls> calls

  Found 1 source file, tested 1, exercised 1 function and executed 1 of 2 paths.
  One seed ran against effects that answered, and 3 against a network that refuses connections, a file system that fails, a writer that takes only part of what it was given and a clock that jumps, one call in 4.
  Stepped over <count> calls for throwing on an input the function was never written for, and stopped <count> units that ran past the budget without returning. The paths they would have covered are not in the count above.
  Swept 4 seeds, with no scenario reporting a wrong answer.
  Drove 3 rounds, each one after the first exploring only the functions with a path left.
  Full detail is in <work>/coverage-report.txt.

  One thing to do:
    spin at spin.ts:3 ran past the budget without returning, so the run stopped it and the paths it was part way through were not counted. Write a scenario calling it with an input it returns for.

  Coverage: 1 of 2 paths, 50%.

  Failed: 1 code path of 2 was never reached.
  The list above says what to do about each one.
  Took <time>.
```

Exit code: 1.

## A run where a parameter has no value to build

Captured from `examples/non-working/25-no-factory`. A type whose value no signature decides. That function's own paths are left off the list: writing the factory is the work.

```sh
$ flt .
```

```
Fault testing the JavaScript and TypeScript in 25-no-factory.

Deterministic simulation of 1 project. The report comes at the end.
  Read 1 source file, with 1 function to exercise.
  Exercising 16 units, scenarios first.
  Reading what those calls reached.

Deterministic simulation

  tagging.ts
    MISS nameOf                             0/3 paths, never called

  Found 1 source file, tested 1, exercised 1 function and executed 0 of 3 paths.
  One seed ran against effects that answered, and 15 against a network that refuses connections, a file system that fails, a writer that takes only part of what it was given and a clock that jumps, one call in 4.
  Stepped over <count> calls for throwing on an input the function was never written for. The paths they would have covered are not in the count above.
  Swept 16 seeds, with no scenario reporting a wrong answer.
  Drove 3 rounds, each one after the first exploring only the functions with a path left.
  Full detail is in <work>/coverage-report.txt.

  One thing to do:
    Write a test input factory returning symbol, which nameOf takes as `tag`. Without one, nameOf at tagging.ts:7 cannot be called at all.

  Coverage: 0 of 3 paths, 0%.

  Failed: 3 code paths of 3 were never reached.
  The list above says what to do about each one.
  Took <time>.
```

Exit code: 1.

## A scenario that said the answer was wrong

Captured from `examples/non-working/23-scenario-fails`. The run says which seed failed, where, with which error, and prints the one command that reproduces it.

```sh
$ flt .
```

```
Fault testing the JavaScript and TypeScript in 23-scenario-fails.

Deterministic simulation of 1 project. The report comes at the end.
  Read 1 source file, with 1 function to exercise.
  Exercising 32 units, scenarios first.
  Reading what those calls reached.

Seed 1 failed in adding.sim.ts:6 addsWrong with Error: AddedWrong.
Reproduce it with: flt --replay "seed=1"
```

Exit code: 1.

## An invariant that stopped holding

Captured from `examples/non-working/26-invariant-fails`. An invariant is checked after every call, so the run stops at the call that broke it.

```sh
$ flt .
```

```
Fault testing the JavaScript and TypeScript in 26-invariant-fails.

Deterministic simulation of 1 project. The report comes at the end.
  Read 1 source file, with 2 functions to exercise.
  Exercising 32 units, scenarios first.
  Reading what those calls reached.

Seed 1 stopped holding in counter.sim.ts:6 theCountIsNeverNegative with Error: TheCountWentNegative.
Reproduce it with: flt --replay "seed=1"
```

Exit code: 1.

## A file that will not parse

Captured from `examples/non-working/24-will-not-compile`. The run stops and prints what the compiler said.

```sh
$ flt .
```

```
Fault testing the JavaScript and TypeScript in 24-will-not-compile.

The simulation would not compile. The compiler said:

broken.ts:2:1: '}' expected.
```

Exit code: 1.

## An option the tool has no name for

Captured from `examples/non-working/27-bad-argument`. The run refuses it and measures nothing, so it exits 2 rather than 1.

```sh
$ flt . --made-up-option
```

```
There is no option called --made-up-option. Run flt --help to see the ones there are.
```

Exit code: 2.
