# A value factory that throws

The sim file's value factory throws instead of returning a value. The function it builds a value for is never called, and Faultline reports the call as not made, with what the factory threw, rather than taking the throw for the function's own.
