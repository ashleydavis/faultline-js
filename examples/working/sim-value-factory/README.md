# A value factory per value

A branch that only runs for one particular value of one of your own types. The bytes each format starts with are worked out while the code runs, so no condition in the source names them and no value Faultline builds from the type reaches them. The sim file beside the source holds a value factory per format, found by its return type, so each branch is reached without a scenario.
