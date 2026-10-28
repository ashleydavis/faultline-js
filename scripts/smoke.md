# smoke.sh

Runs every check under `src/smoke/`, then `npx flt` in every example under `examples/working/` and `examples/non-working/`, and checks what each printed against its `expected.txt`. It also checks the following for each example. The run writes no file into the example's directory outside `node_modules`. A working example exits 0 and a non-working one exits non-zero. Every replay command the run printed fails the same way twice. A run that printed a report keeps at least one entry in the compile cache and prints the same report with `--jobs 1` and `--jobs 4` (the run with `--jobs 1` reading the compile cache the first run filled, so it also compares compiling every file with compiling none). A run that reads its results from the cache prints the report of the run that filled it, and a run after it that keeps its crashes reads every kept crash's answer from the cache and replays none.

Each example finds Faultline through `node_modules`, as a project that installed it does. The script builds the tool with `bun run build` first, then links `node_modules/faultline` to the clone and `node_modules/.bin/flt` to the built command. An example that imports a package of its own keeps it under `packages/`, and the script links each one into `node_modules` under its directory's name. An example run with options carries them in `run-flags.txt`, one per line. An example that needs Node options carries them in `node-options.txt`, which the script puts in `NODE_OPTIONS`.

A check is a file named `<name>.smoke.ts`, run with the Node on the `PATH`. It checks what a unit test cannot, because a unit test reaches no file, network or other process. The checks cover `flt` refusing an older Node and Bun, a project file and a package reaching the simulated `node:fs` through the module hooks, coverage read per call in a process of its own, `docs/FAILURES.md` matching the failure table in code and a replay giving the answer the run gave. A check writes the small project it loads under `tmp/smoke/checks/`. The checks run one after another before the examples, and on the first shard only.

Each check and example prints a line with its verdict and how long it took as it finishes, and again in name order at the end. Logs go to `tmp/smoke/`. A run of every example captures the `smoke` baseline for what-changed.

## Usage

```sh
bash scripts/smoke.sh [--parallel <n>] [--shard <n>/<total>] [smoke-test-name]
bun run smoke [--parallel <n>] [--shard <n>/<total>] [smoke-test-name]
```

- No arguments: prints the usage, then runs every example.
- `smoke-test-name`: runs only the example with that directory name, or the check with that name.
- `--parallel <n>`: how many examples run at once. `PARALLEL` sets it when the option is absent. When neither is set, it is the value of `DEFAULT_PARALLEL` in the script, which matches the cores of a hosted CI runner.
- `--shard <n>/<total>`: runs every total-th example starting at the n-th, for one CI runner.
- `--help`: prints the usage and stops.
