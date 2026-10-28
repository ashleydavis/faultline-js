# An await in a side of a conditional

A function waits for one of two readers in the sides of a conditional, then branches on what it read. V8 counts the code after the conditional as often as one of its sides ran, not as often as the code itself ran, up to the next block, so the false side of the `if` right after it cannot be proved to run. Faultline lists that path as `not provable` in the report file instead of asking for a scenario that would make no difference, and the rest of the function is counted as usual.
