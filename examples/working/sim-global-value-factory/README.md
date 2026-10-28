# A value factory in global.sim.ts

`store.ts` and `reader.ts` both take an `IStore`. Its value factories are in `global.sim.ts`, which Faultline uses for every file, so both `valueOf` and `firstOf` are called with the stores the factories give and every code path is exercised.
