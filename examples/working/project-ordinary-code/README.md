# Ordinary code

A shopping cart and a settings reader, written the way the code in any project is written. The cart is plain data in and plain answers out, and every code path in it is reached by boundary values and the values read from its conditions. The settings reader imports `node:fs/promises`, parses what it read, falls back when a field is missing and handles the file not being there and the file not parsing.

The simulated filesystem starts empty, so a missing file is reached with no help and every failure a read can have is injected at the read. A file that parses and a file that does not have to be written first, which is what the two scenarios in `parse.sim.ts` do.
