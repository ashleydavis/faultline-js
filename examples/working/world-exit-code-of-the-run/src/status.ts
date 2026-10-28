//
// Code that sets the process's exit code and code that reads it.
//

//
// Says that the process is to end in failure, without ending it.
//
export function markFailed(): void {
    process.exitCode = 1;
}

//
// How the process is to end, by its exit code.
//
export function readStatus(): string {
    if (process.exitCode === undefined) {
        return "clean";
    }
    return "failed";
}
