# Everything at once

One project holding every kind of code Faultline reads and every part of the simulated world, so a change that breaks one of them is seen here rather than in a project someone else owns.

The code is an order book. `orders.ts` is written the way ordinary code is: a class with a constructor, methods, a getter, a setter and a static method, a function the file does not export, a function written inside another, a `switch`, a loop, a short circuit, a `try` and its `catch`, a generic, an optional property and a rest parameter. `service.ts` reaches the clock, the filesystem, the network, another program, a name lookup, random numbers and standard output, and declares none of them.

`orders.sim.ts` holds several value factories for one type, a value factory written as a class and scenarios. `service.sim.ts` holds the scenario that writes the settings files the reader needs. `src/generated/` is left out by `exclude` in `faultline.config.yaml`, `notes.md` is not source, `shapes.d.ts` declares types and holds no code, `quiet.ts` declares no function and `page.ts` imports a stylesheet.
