# A top level that never finishes

A file whose top level loops for ever, so loading it never finishes. Faultline stops opening the file when its limit on opening a file passes, reports the file's top level as a call that never returned and opens the file only that once.

`environment.txt` sets `FAULTLINE_OPEN_LIMIT_MS` to 8000, so each run waits 8 seconds rather than Faultline's own 30, while still leaving the child time to compile the file and keep it in the compile cache. The child keeps it there about 1.3 seconds after the run starts on a developer machine, and a GitHub Actions runner is slower: at 2000 the CI smoke test failed with the run keeping nothing in the compile cache.
