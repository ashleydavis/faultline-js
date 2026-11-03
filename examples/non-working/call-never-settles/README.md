# A call that never settles

`nextMessage` waits for a message no code ever sends, so the promise it gives never settles. Faultline waits for the call until its call limit passes, then reports it as a call that never returned and prints a command that repeats it.

`environment.txt` sets `FAULTLINE_CALL_LIMIT_MS` to 1000, so each call waits 1 second rather than Faultline's own 10.
