# The report file where you asked

`--report node_modules/.cache/where-asked.txt`, given through `run-flags.txt`, writes the report file there instead of to its usual place. A relative path is taken from the project root. The path is inside `node_modules`, because Faultline writes only where it is told and the smoke test checks the example's own files are left as they were.
