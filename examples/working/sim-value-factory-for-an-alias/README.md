# A value factory for a type alias of a library type

The project names a read-only record `JsonObject`, an alias of `Readonly<Record<string, unknown>>`. Faultline reads the alias's name off the parameter as it is written, so the value factories in the sim file beside the source, which return `JsonObject`, are the values the function is called with. Faultline's own records are empty, and only a record with the field reaches every branch.
