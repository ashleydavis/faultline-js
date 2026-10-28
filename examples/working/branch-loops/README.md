# The body of every loop

Every kind of loop has one code path: its body running. A loop whose body never runs leaves that code path not exercised, which is how a list that is always empty is found. Faultline passes an empty list and a list of one value, so each body runs.
