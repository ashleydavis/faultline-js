//
// A value factory for shelves that throws, which is the defect this example shows.
//

import type { IShelf } from "./shelves.ts";

//
// Reads a shelf from a file that is not there, and throws because it is not.
//
export function shelfFromFile(): IShelf {
    throw new Error("The shelf file is missing.");
}
