# One parameter changed at a time

A function of three parameters with a branch that only runs when two of them change together. Faultline calls a function with the baseline values and then with each parameter's other values one at a time, never two changed at once, so the branch is missed and the run asks for a scenario or a value factory that reaches it.
