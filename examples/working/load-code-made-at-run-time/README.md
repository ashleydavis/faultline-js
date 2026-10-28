# Code made at run time

`scale` makes a function with `new Function` on every call that takes the small branch, the way schema libraries such as zod compile their checks. V8 reports that code with no file, and Faultline leaves it out of coverage and carries on in the same child process. Every code path of `scale` is exercised.
