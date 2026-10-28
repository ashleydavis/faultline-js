# A Node project

A `package.json`, a `tsconfig.json` and a `src` directory, which is how a Node project written in TypeScript is laid out, with its imports naming `.js` files as Node's own resolution wants. Faultline reads the `tsconfig.json`, so it sees the same types the editor does, and finds the `.ts` file behind each `.js` import.
