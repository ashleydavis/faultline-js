# One file with the scenario that covers it

Run with `--file` naming a source file whose sim file has a scenario. One branch is reached only by the scenario, because its condition is worked out from the value rather than compared with it. The run narrowed to the file runs the scenario too, so the coverage line is what a run of the whole project gives the file. The other file is left out. The options this example is run with are in `run-flags.txt`.
