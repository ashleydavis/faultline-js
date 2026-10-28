# The Faultline contract

What Faultline promises and what it asks of you. Where the tool and this file disagree, this file is right and the behaviour is the defect.

## What Faultline is for

Faultline calls every function in a JavaScript or TypeScript project with generated inputs and injected failures until every code path has been exercised and reports the ones that have not.

## What you add

Faultline is a package your project depends on.

Add it to your project:

```sh
npm install --save-dev github:ashleydavis/faultline-js
```

Run Faultline in your project like this:

```sh
npx flt
```

Faultline tries to exercise every code path automatically and exits with error code 1 when it can't do that. Usually it can't get to 100% coverage on its own and you need to help it. So it prints a checklist for you to follow. Each item in the checklist gets you one step closer to 100% coverage.

## Faultline writes nothing into your repository

This is the most important promise in this file and it is absolute.

Faultline does not create a file or a directory in your repository and does not change a byte of anything already there. Everything Faultline generates goes in `node_modules/.cache/faultline/`, which your package manager owns and git leaves out.

## What Faultline promises

1. Faultline never edits your source. You write the `.sim.ts` files yourself and Faultline only says where one is needed.

2. Node 24 or later is required, because Faultline reads coverage from V8, the engine inside Node. If Node is older, Faultline prints one sentence saying so and exits 1 before it runs anything.

3. Failures are injected systematically, never at random. Each failure is injected at every call in a function that could fail that way, one failure per call. Faultline gives up on a code path only when it has tried every value and every failure it has for that code path.

4. Input values are the boundary values of each type plus a few random ones. Each run starts the random number generator from a new seed. If those values leave a code path unexercised, Faultline reads the conditions in your source and tries values on each side of them.

5. Faultline asks for a scenario only when it cannot find values that exercise a code path.

6. Expectation functions run after every call of a function in the matching source file and after every scenario in the matching sim file.

7. Faultline prints a report with the coverage percentage and a checklist of what to do next.

8. Every Faultline result has a replay token. The token holds the plan of injected failures, the values chosen and the seed. Nothing else is needed to replay it: no environment, no log, no leftover state, no second flag.

9. A replayed token drives the same calls in the same order and gives the same answer, on any machine, for the same source. A token that does not reproduce its result is a defect in Faultline.

10. Faultline exercises every function and reports the complete result. Faultline never skips anything to be faster.

11. You can point Faultline at one file or one function and then it runs fault tests only for that.

12. Faultline says what it decided and why: which directories it took as source, which it skipped, which functions it could not call and what stopped each one.

13. Faultline adds one command, `flt`, to your project. It reads your types and your module resolution from your `tsconfig.json`.

## What Faultline asks of you

- Node 24 or later.
- A value factory for each of your own types that Faultline cannot instantiate, in the sim file beside each source file whose functions take one. Faultline uses a sim file's value factories only for the functions in the source file beside it, except those in a `global.sim.ts`, which it uses for every file.
- A scenario for each code path Faultline cannot exercise by itself.

Faultline asks for these in its checklist, each naming the file and the line. Neither is needed before the first use.
