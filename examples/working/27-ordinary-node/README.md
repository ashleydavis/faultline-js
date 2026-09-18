# Ordinary code, nothing written for the tool

A shopping cart and a settings reader, written the way the code in any project is written. The cart is plain data in and plain answers out. The settings reader imports `node:fs/promises`, parses what it read, falls back when a field is missing, and handles the file not being there and the file not parsing.

No file here imports anything from Faultline. There is no test input factory and no scenario. Every code path runs.

The settings reader is what makes this example worth keeping. Its error handling only runs when a read fails, and the branch that fills in a default only runs when the file it read leaves that field out. Both come from the run's own file system, which fails the way the runtime fails whenever the injector says so and leaves one field out per turn.
