# A callback that throws, and a value that arrives as nothing

A run passes a function in and the code under test calls it. That function throws and rejects in turn, so the code that handles a callback failing is reached.

A run also hands a parameter `null` and `undefined`, whatever its type said. No signature says that can happen, and it is where a TypeError comes from in a running program, so the run does it on purpose.
