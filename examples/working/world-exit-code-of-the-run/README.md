# The exit code of the run

`process.exitCode` starts unset in every run, as it does in a process, so what one call or scenario set is never what the next one reads. The second scenario reads it in a run of its own and finds it unset after the first one set it.
