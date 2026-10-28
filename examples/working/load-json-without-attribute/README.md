# A JSON file imported without an import attribute

A Bun project imports a JSON file with no `with { type: "json" }`, as Bun and bundlers allow and Node refuses. Faultline gives every import a project file writes that leads to a JSON file the attribute Node needs, so the code runs unchanged.
