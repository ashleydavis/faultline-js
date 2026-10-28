# A value factory for a built-in type

A function formats a `Date` it is given, and every `Date` the project holds is valid because the code that makes them checks. Faultline's own dates include an invalid one, which would crash `toISOString`. The sim file beside the source has factories returning `Date`, so Faultline uses only their dates for that function, as it does for a type of the project's own.
