//
// Loaded before `flt` by the smoke test, so `flt` reads Node 22 as the version it runs under,
// which is older than it needs.
//

Object.defineProperty(process.versions, "node", {
    value: "22.22.2",
    enumerable: true,
    configurable: true,
    writable: false,
});
