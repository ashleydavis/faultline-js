# A module whose top level reads the environment

The top level of `mode.ts` reads `MODE` from the environment when the file is imported. The simulated environment starts empty, so importing the file reaches the code path for no mode. The scenario in `mode.sim.ts` sets `MODE` and imports the file afresh with `context.load`, which runs the top level again and reaches the code path for a mode that is set.
