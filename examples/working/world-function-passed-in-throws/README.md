# A function passed in that throws

Faultline passes in a function of the parameter's type. Each call of it is a place where it can throw, or reject when it returns a promise, so the code that handles a function passed in failing is reached without a scenario.
