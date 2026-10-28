# A project built with a bundler

What a Vite project carries that a Node one does not: a `.tsx` file, an import through a path alias and an import of a stylesheet. Faultline reads the alias out of the `tsconfig.json`. A stylesheet, an image or any other file a bundler turns into an asset loads as an empty module, because Node loads none of them and the code under test only needs to run.
