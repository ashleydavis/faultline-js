# Faultline

Faultline automatically runs all code paths in all your JavaScript and TypeScript functions proving that all code paths run without problems.

This isn't about proving that your code does what it is supposed (that's why you should have unit tests, smoke tests, integration tests, end-to-end tests, etc).

Instead Faultline is to test that your code can handle every combination of inputs and faults thrown at it without crashing.

## What it does

Faultline calls every single function in your project and exercises every possible code path. It tries every input combination and injected fault to find every code path.

It is a package your project depends on. One line puts it in, and then `npx flt` is the whole of running it.

```sh
npm install --save-dev github:ashleydavis/faultline-js
```

## The work you have to do to make this possible

- Provide factory functions for your custom types to Faultline so it can automatically build inputs to your functions (all standard types are covered automatically, this is only needed for your custom types).
- Provide scenario functions that exercise code paths that Faultline can't reach by itself.
- Provide invariant functions for anything that has to hold after every call.

Nothing is annotated. V8 counts every block it runs, so Faultline reads which code paths ran without anything being written into your code.

## Node and the browser

`npx flt` runs your code in Node. Code that reads a document, a window or an element needs a browser, and `npx flt --browser` runs it in one.

## Resources

- [Quick reference](docs/QUICK-REF.md) to add Faultline to a repository and use it.
- [User guide](docs/USER-GUIDE.md) to exhaustively test every function you write, with minimal effort.
- [Output](docs/OUTPUT.md) for what a run prints and what each line means.
- [Development](docs/DEVELOPMENT.md) to work on Faultline itself.
