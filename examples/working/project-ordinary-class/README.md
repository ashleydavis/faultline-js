# A class, a retry and a parser

A queue with a limit, a retry that waits between attempts and a parser that splits a string on a separator, written the way the code in any project is written.

The retry waits between attempts. Timers run in simulated time, so a wait of seconds costs the run no time. The function it retries is one Faultline passes in, which rejects at every call it is told to, so every attempt failing is reached. The parser splits on `-`, and the separator is not in a condition, so no value read from a condition has it. The scenario in `retry.sim.ts` gives the parser ranges.

Every call starts from a new copy of the file, so a queue Faultline builds is always empty and its loop body never runs from a single call. The scenario in `queue.sim.ts` fills a queue and empties it.
