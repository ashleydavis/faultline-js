# A package's file imported without its extension

A Bun project imports a file of a package without naming its extension (`clock-words/plugin/hours`), as Bun and bundlers allow and Node does not. The `tsconfig.json` says bundler resolution, so Faultline tries the extensions a bundler tries when Node finds no file of that name, and the code runs unchanged. The package is under `packages/`.
