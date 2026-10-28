# A CommonJS package that requires a built-in module

The project uses a package written as CommonJS, which loads `fs` with `require`. Faultline gives a `require` of a built-in module it simulates the simulated one, as it does an `import`, so the package reads the run's filesystem and never the disk. The scenario writes the settings file in the run's filesystem and the package finds it there. The package is under `packages/`.
