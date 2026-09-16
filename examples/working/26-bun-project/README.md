# A project laid out for Bun

Bun's own layout: a `module` entry in the manifest rather than a `main`, and a `tsconfig.json` written the way `bun init` writes one.

Faultline runs the code in Node whichever runtime a project targets, so what is written here runs unchanged. A function that calls Bun's own globals has nothing to answer it in Node, and needs a test input factory standing in for what it reaches, the same as any other type Faultline cannot build.
