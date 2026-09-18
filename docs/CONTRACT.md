# The Faultline contract

What flt promises and what it asks of you. Where the tool and this file disagree, this file is right and the behaviour is the defect.

## What flt is for

Every file, every function, every code path.

flt calls every function in a JavaScript or TypeScript project with every combination of inputs and injected faults until every code path has been exercised, and reports the ones that have not.

## What you add, once

Faultline is a package your project depends on. One line puts it in, and it is the whole of it.

```sh
npm install --save-dev github:ashleydavis/faultline-js
```

That adds one command, and running it is the whole first run:

```sh
npx flt
```

It finds your source by walking your tree, so you never list your files, your functions or your directories. Adding, renaming, moving or removing one changes the run without anything being typed.

What comes back is a list of errors naming the code paths no call reached. Reducing that list is the work, and it is done by adding test input factories and scenarios to the project until every path is reachable.

An unreached code path is an error, so the run stays red until every one of them is reached.

## It writes nothing into your repository

This is the most important promise in this file, and it is absolute.

Faultline does not create a file in your repository, does not create a directory there, and does not change a single byte of anything already there.

Everything a run generates goes in a directory of its own under the system's temporary directory.

A run that is killed halfway leaves the repository exactly as it found it.

An earlier version of this tool wrote over three hundred thousand generated files into the what-changed repository during a single run, and the repository had to be thrown away and cloned again. That is the failure this promise exists to make impossible, and any amount of writing into a fault tested repository is that same failure in a smaller size.

## What flt promises

1. It runs on the two lines above. It finds your source, your functions and your directories by walking your tree, so the run stays right as they are added, renamed, moved and removed.

2. Its footprint in your repository is as small as it can be made: test input factories, scenarios and invariants in sim files, and nothing else. No file being measured is touched.

3. It never edits your source. You add the factories and the scenarios yourself, and flt only says where one is missing.

4. It writes nothing of its own into your repository, as above.

5. Your repository depends on one small flt package to get the types it needs, and that package is the only thing it takes from flt.

6. Your repository never supplies a recorder, a marker on a branch, or any other recording machinery. V8 counts the blocks it runs and flt reads that, so a branch is seen without anything being written into your code.

7. The terminal gets a short report: what it drove, the coverage number, and the few things worth doing next. The full list goes to a file named on one line.

8. Every run is described by a plan, and the plan holds everything needed to reproduce that run. Failing or not, a run is replayed by handing its plan back, and nothing else is ever needed to do it: no environment, no log, no leftover state, no second flag.

9. A replayed plan drives the same calls in the same order and gives the same answer, on any machine, for the same source. A plan that does not reproduce its run is a defect in flt.

10. A run is quick enough to sit through. It drives everything there is to drive and reports the complete answer, and it takes a minute or two on a real repository rather than an afternoon. There is no time it has to come in under, and it never drives less to be faster.

11. It can be pointed at one file or one function, and then it fault tests only that.

12. It says what it decided and why: which files it took as source, which it skipped, which functions it could not call, and what stopped each one.

13. No embedded code. flt does not carry the text of one language inside another, and does not build source by printing it. One exemption stands: the empty module that stands in for a stylesheet or an image, because a bundler's project imports assets Node cannot load and the run only needs the code to run.

14. Faultline arrives as a dependency your project declares, fetched and cached by npm like any other, so your project pins the version it wants and gets that one.

15. A run reads which paths ran from V8, which reports the same thing in Node and in a browser. Code written for a browser is run in one with `--browser`.

16. Faultline takes your types from your project. Your `tsconfig.json` says what they are, and that is the only answer it uses.

17. Every line the report names is a line in your source. The copy that runs carries a map back to it, so an error thrown by your code names your line rather than a line of the copy.

18. A function that never returns does not stop a run. It is stopped at a budget, named in the report, and everything after it still runs. Nor does one that ends the process: the run starts again at the unit after it.

19. A scenario runs against effects that answer. Nothing fails underneath a scenario unless the scenario asks for it by name, so a scenario that fails has found something real.

20. What a run breaks is not only the effects it supplies. A function it passes in throws and rejects, and an argument arrives as `null` or `undefined` whatever its type said.

21. An invariant is checked after every call and after every scenario, so a run says which call broke it rather than only that something did.

22. A run reaches every place an effect could fail, not only the places it happened to land on. After the first round it drives the functions with a path left, calling each once to see where its effects could fail and once more per place and per way.

## What flt asks of you

A test input factory for a type flt cannot build for itself.

A scenario for a path no made up call reaches.

Both are asked for one at a time, by an error naming the file and the line, and neither is ever needed before the first run.

Everything else buys precision rather than entry, and a project that writes none of it still gets a report: an invariant, a factory per fault, a scenario that asks the injector for a named failure.

## What flt does not count

A `try` whose body throws every time. Every byte of such a function runs, so V8 reports it as covered, and it is. A scenario or an invariant is what says the other way has to happen.

The skipped side of `&&`, `||` or `??` inside a loop's own condition. A condition tested once per turn sits in the block around the loop, so there is no count to take it from. The report says how many there are.
