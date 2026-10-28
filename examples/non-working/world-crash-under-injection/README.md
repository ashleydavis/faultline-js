# A crash that only a failure shows

`statusOf` treats a request that failed as having no answer and then reads the answer's status anyway. A request in the simulated world succeeds unless a failure is injected, so the call works. Faultline makes the request fail, the function reads a property of `undefined`, and the report names the crash with a command that repeats exactly that call. The smoke test runs the command twice and checks it crashes the same way each time.
