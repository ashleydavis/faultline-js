# A call that never settles

`nextMessage` waits for a message no code ever sends, so the promise it gives never settles. There is no timer left and no other work under way, so Faultline knows at once that the call never settles, reports it and prints a command that repeats it.
