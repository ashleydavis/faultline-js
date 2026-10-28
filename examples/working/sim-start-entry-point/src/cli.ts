//
// A file that does one thing when it is imported and another when it is the file that was run.
//

//
// How the file was reached.
//
export const reachedAs = import.meta.main ? "run" : "imported";
