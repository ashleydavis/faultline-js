# A class, a retry and a parser, nothing written for the tool

A queue with a limit, a retry that waits between attempts, and a parser that splits a string on a separator.

No file here imports anything from Faultline. There is no test input factory and no scenario. Every code path runs.

Three things make this example worth keeping. The body of the queue's own loop only runs when something was put in the queue before it was drained, so the run calls the class's other methods on the object first. The retry waits between attempts, and a run that waited would take an hour, so the replaced timers do the work at once and move the run's own clock instead. The parser splits on `-`, and a string that is only `-` splits into two empty pieces, so the run builds strings with something on either side of the separator the file names.
