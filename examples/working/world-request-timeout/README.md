# A request's timeout

A request made with a `timeout` gives up when the connection carries nothing for that long. A scenario stands in for a service that never answers, and the request's timeout runs out on the run's clock, so the scenario ends at once instead of waiting.
