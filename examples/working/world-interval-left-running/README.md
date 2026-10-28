# An interval left running after the call returns

A function starts an interval and returns a way to stop it, as a schedule does. A run that fails is counted and the schedule carries on. Faultline calls it with every delay its type allows, a millisecond included. Once a call has returned, each timer it left behind runs once more and a repeating one is not set again, so the interval's work is exercised and a millisecond interval does not run on after every call. The scenario calls `stop`, which Faultline cannot reach itself.
