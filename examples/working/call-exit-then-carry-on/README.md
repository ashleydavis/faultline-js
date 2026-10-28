# A call of process.exit, then calls that carry on

One function calls `process.exit` and the function after it in the same file does not. Ending the process is how a program stops, so a call of `process.exit` is no failure: the call ends where it calls `process.exit`, the code paths it reached are counted, and every code path of the function after it is still exercised, because the calls after it carry on.
