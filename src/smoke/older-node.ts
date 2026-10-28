//
// Loaded with `--import` ahead of `flt` by `src/smoke/node-refusal.smoke.ts`, so `flt` reads a
// Node version older than the one it needs from `process.versions`, which is where it reads the
// version from, and the check needs no second Node installed.
//

Object.defineProperty(process.versions, "node", {
    value: "22.22.2",
    enumerable: true,
    configurable: true,
    writable: false,
});
