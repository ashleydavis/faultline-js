# A Node older than Faultline needs

Faultline needs Node 24 or later and refuses to start under an older one, with one sentence and exit 1. The smoke test runs this example with the options in `node-options.txt` in `NODE_OPTIONS`, which load `src/older-node.mjs` before `flt` starts so `flt` reads the running Node as version 22.
