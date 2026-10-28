# An expectation function after every call

An expectation function in the sim file beside the source checks what has to hold after every call of a function in that file. Faultline finds it by its one parameter, an `ExpectationContext`, and runs it after each call with no failure injected into it.
