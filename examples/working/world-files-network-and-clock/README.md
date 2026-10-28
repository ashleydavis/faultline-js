# Files, the network, the clock and timers

Code that reads and writes files, fetches over the network and waits on a timer, with none of it written for Faultline. Each is replaced by the simulated world, and each call of one is a place where Faultline injects every failure the call can have, one failure per call, so the code paths that run only when something goes wrong are reached without a scenario.

The simulated filesystem starts empty. The two code paths that need a settings file to exist are reached by the scenarios in the sim file beside the source, which write the file first.
