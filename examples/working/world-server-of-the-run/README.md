# A scenario standing in for a service

A function asks a service for its health over HTTP and says what it answered. Faultline's network answers every request with an empty body, so only a scenario reaches the branches that read a real answer. The scenario starts a server with `node:http`, listening on a port of the run's network, and points the function at it on `127.0.0.1`. The request is carried to that server in memory and the function gets its answer, as it would from a real service.
