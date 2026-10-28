# Faultline

Fault testing for JavaScript and TypeScript.

Faultline runs every code path in your project, both happy paths and error handling paths. It's job is to get to 100% code coverage and if possible make your code crash (so you can then adjust your code to make it uncrashable).

Faultline works automatically as far is it can, but usually needs some help from you (explained below) to find all code paths from every function in your project.

Faultline does not check that your code does what it is supposed to. That is for unit, smoke, integration and end-to-end tests. Faultline checks that your code survives every input and failure that is thrown at it.

## What Faultline does

Faultline calls every JavaScript and TypeScript function in your project with chosen inputs, injects every failure at every call that could fail that way and reads which code ran from V8. It picks failures systematically. Its few random input values come from a random number generator. A replay uses the seed of the run it replays, so it gets the same results.

Faultline is a package your project depends on. `npx flt` runs Faultline.

## Install

Point your AI agent at the [AI quick reference](https://github.com/ashleydavis/faultline-js/blob/main/docs/AI-QUICK-REF.md). It tells the agent how to add Faultline to your project and how to work through the report to 100% coverage with no failure left. Start it with:

```
Read https://raw.githubusercontent.com/ashleydavis/faultline-js/main/docs/AI-QUICK-REF.md and follow it to add Faultline to this project. Then follow its loop to 100% coverage until `npx flt` exits 0.
```

## What you do

- Have Node 24 or later. Faultline runs your code in Node, whatever runtime your project uses in production.
- Write value factories for your own types that Faultline cannot instantiate, so Faultline can build inputs to your functions.
- Write scenarios for code paths that Faultline cannot exercise.
- Optionally write expectation functions: checks that run after every call and after every scenario.

## Resources

- [AI quick reference](docs/AI-QUICK-REF.md) to add Faultline to a repository and use it.
- [User guide](docs/USER-GUIDE.md) for the full detail.
- [Contract](docs/CONTRACT.md) for what Faultline promises.
- [Failures](docs/FAILURES.md) for every failure type Faultline injects.
- [Development](docs/DEVELOPMENT.md) to work on Faultline itself.
