# A project built with a bundler

What a Vite project carries that a Node one does not: a `.tsx` file, an import through a path alias, and an import of a stylesheet.

Faultline reads the alias out of the `tsconfig.json`. A stylesheet, an image or anything else a bundler turns into an asset stands in as an empty module, because Node loads none of them and the code under test only needs to run.

The code here reads no document, so it runs in Node. A file that does needs `--browser`, which `23-browser` shows.
