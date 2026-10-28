# A scenario

A code path that needs two calls in an order, which no single call reaches. A scenario in the sim file beside the source makes the two calls. Faultline finds it by its one parameter, a `ScenarioContext`, and never by its name.
