# Development

How to work with and contribute to this repo.

## Setup

Install dependencies:

```sh
mise install
bun install
```

## Commands

- `bun run build` type-checks the Faultline source and its tests and writes the JavaScript to `dist/`.
- `bun run test` runs the unit tests.
- `bun run coverage` runs the unit tests and prints the code coverage of each source file.
- `bun run smoke` (or `bash scripts/smoke.sh`) builds the tool, runs the checks in `src/smoke/` that need a real Node process, then smoke tests against all examples. It runs them with the Node on the `PATH`, which `mise.toml` locks to a version `engines.node` in `package.json` allows, and stops at once under an older one.
- `bash scripts/test-everything.sh` runs the build, the unit tests and the smoke tests several at a time and stops at the first one that fails. It runs only the ones whose files changed since each last passed.

## How a run is split between workers

Each pass of a run is split into shards, one per source file or sim file, and up to `--jobs` workers run the shards at once, each a Node process of its own with its own work, result and progress files. A shard never splits a file, so the calls of one function stay in one worker and it reads that file's conditions once. The driver reads what the shards found in shard order, not in the order the workers finish, and the shards do not depend on the number of workers, so the report is the same with one worker or many. Every call loads copies of the project's modules of its own, and a value factory class is built anew for every value, so a call gives the same answer whatever calls came before it and a replay makes only the call its token names. The module hooks that resolve and load project files run on a loader thread of their own, and every question is a round trip to it, so hooks on the process's own thread (`src/load/kept-hooks.ts`) keep the answer the loader thread gave for the first copy of each file and give it to every later copy under its own copy number. They also send a package's `require` of a built-in module, such as `http`, to the simulated module, because a `require` is resolved by these hooks and Node's own resolver and never reaches the loader thread. Every worker writes how far it has got to a progress file and the driver prints one line for all of them.

A worker starts its process again after a call that never answered (the process is killed), after the process ended part way through a call and after a fixed number of calls, so the copies of modules left behind do not grow without end. A call of `process.exit` keeps the process, because the simulated `process.exit` stops the call inside it and the process itself never exits. A shard whose file the process could not open, because the process ended or the open ran past its limit, is opened once: its calls are answered from how the open failed, and that failure is neither replayed for the report nor kept as a crash, because opening such a file again can take minutes.

Each worker's process reads V8's coverage every few calls and at the end of every function and scenario, and after every call in a shard with expectation functions, because a reading costs time for every function and object in the process's isolate and the run needs only what the calls together exercised. A process that ends before it reads has the calls since its last reading made again in a new process, which reads what they exercised. The process reads each shard with the TypeScript compiler, and finds the code paths of each file it counts, on a worker thread of its own (`src/run/reader-thread.ts`), whose isolate no reading covers. Only the results cross to the process.

## How compiled files are kept between runs

`src/run/compile-cache.ts` keeps what the reader thread works out with the TypeScript compiler in `node_modules/.cache/faultline/compiled/`: a shard's reading (its functions, conditions and sim facts) and a file's measurement (where its code paths sit in the loaded text). A reading is stored with a key made from the shard's file, its sim files, every file under its `tsconfig.json` that holds a `declare global` or `declare module` block, every project file those import at any depth, the compiler options of the `tsconfig.json` that owns the file, the project's lockfile and a hash of every file of Faultline's own code. A measurement's key is made from the file, its compiler options, its nearest `package.json`, the lockfile and Faultline's code. An entry holds its key, and a run uses it only when that key is the one it works out now. An entry written under another key or another format, or one that cannot be decoded, is worked out again and written over. An entry is written beside its place and renamed into it, so a worker reading it at the same moment reads the old entry or the new one. A run reads a file with the compiler only when its entry misses, so an unchanged file is never compiled again by a later shard, a restarted child or a later run. `--no-cache` leaves the compile cache in use, because it holds no result of a call, and `npx flt clear` throws it away with the kept results.

## How results are kept between runs

`src/run/results-cache.ts` keeps the complete result of each source file and sim file in `node_modules/.cache/faultline/results/`. A result is stored with the file's key: a hash of the file, its sim file, every `global.sim.ts`, every file under the file's `tsconfig.json` that holds a `declare global` or `declare module` block (the shard's program holds those whether or not a file imports them), everything those files import at any depth, the project's lockfile and Faultline's own version and source. A source file's result also names every file whose calls ran any of its code, with their keys, because a code path can be exercised by another file's calls. A run uses a result only while its key and every one of those keys are unchanged, and runs again every file that exercised the code paths of a file it runs again. Failures are listed in table order, so a run from the cache reports them in the order the run that made them did.

## How crashes are kept between runs

`src/run/crash-store.ts` reads and writes `node_modules/.cache/faultline/crashes.txt`, one replay token per line. Before any call, the driver answers every kept token, adds each that still fails to the run's failures and drops each that no longer names a call. A token is answered from the results cache when its file's stored result has the key the file has now, whether or not that result is used as it is: the result holds the answer (failures and values) of every call that first found a crash and of every kept token replayed with that key, and a call goes the same way every time its file has the same key. Every other token is replayed with `src/run/replay.ts`, and its answer is kept with the file's result. The crash view of the report's first failure takes its values from the answer of its call, and replays the call only when the run has no answer for it. After the run it writes back the kept tokens followed by the token of every crash the run found, leaving out a token that differs from a kept one only in its seed, unless one of its values (written with `s`) was drawn from that seed. The file is outside `results/`, so `--no-cache` and `npx flt clear` leave it alone. The smoke tests throw it away before each example so an example prints what its `expected.txt` holds.

## CI

`.github/workflows/ci.yml` runs on every push and pull request. The unit tests and the smoke tests run at the same time on runners of their own. One runner runs `bun run build` and `bun run test`. The smoke tests are split over several runners, each running `bash scripts/smoke.sh --shard <n>/<total>`.

## The pre-commit hook

The repository has a git pre-commit hook in `.githooks/pre-commit`. It runs `bash scripts/test-everything.sh` and refuses the commit if any check fails.

Run this once each time you clone the repo:

```sh
bash scripts/install-hooks.sh
```

## The examples

Every directory under `examples/` is a small project of its own: it declares Faultline as a dependency in its own `package.json`, exactly as a real project does.

`bash scripts/smoke.sh` runs `npx flt` in each of them. `examples/working/` is one feature per directory and `examples/non-working/` is one failure per directory.

Run one example on its own:

```sh
bash scripts/smoke.sh branch-one-function
```
