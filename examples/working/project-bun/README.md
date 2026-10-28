# A Bun project with extensionless imports

Bun's own layout: a `module` entry in `package.json` rather than a `main`, a `tsconfig.json` written the way `bun init` writes one, and imports that name no extension. Faultline runs the code in Node whichever runtime the project uses, and resolves each extensionless import the way the `tsconfig.json` says, so the code runs unchanged.
