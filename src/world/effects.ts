// The errors the simulated effects fail with, built the way Node builds them.
//
// Code under test that reads `error.code`, `error.syscall` or `error.path`, or prints the message,
// reads what it would read in production, so the code that handles a failure is exercised against
// the error it handles.

// The code a failure id fails with, for every failure whose row in `docs/FAILURES.md` says "fails
// with" a code. A failure id names the same thing in every group it appears in, so one list serves
// them all. A failure missing here is one the effect carries out some other way, such as a short
// read.
const codesByFailure: Record<string, string> = {
    "file-not-found": "ENOENT",
    "access-denied": "EACCES",
    "is-a-directory": "EISDIR",
    "not-a-directory": "ENOTDIR",
    "already-exists": "EEXIST",
    "name-too-long": "ENAMETOOLONG",
    "symlink-loop": "ELOOP",
    "out-of-space": "ENOSPC",
    "read-only-filesystem": "EROFS",
    "too-many-open-files": "EMFILE",
    "input-or-output-error": "EIO",
    "read-of-a-directory": "EISDIR",
    "quota-exceeded": "EDQUOT",
    "create-over-an-existing-path": "EEXIST",
    "create-without-permission": "EACCES",
    "create-in-a-missing-directory": "ENOENT",
    "read-a-link-that-is-not-a-link": "EINVAL",
    "read-a-link-that-is-missing": "ENOENT",
    "remove-a-link-that-is-missing": "ENOENT",
    "hard-link-across-filesystems": "EXDEV",
    "open-a-missing-directory": "ENOENT",
    "open-a-file-as-a-directory": "ENOTDIR",
    "name-does-not-resolve": "ENOTFOUND",
    "connection-refused": "ECONNREFUSED",
    "connection-times-out": "ETIMEDOUT",
    "network-unreachable": "ENETUNREACH",
    "connection-reset-part-way-through": "ECONNRESET",
    "name-server-fails": "ESERVFAIL",
    "host-lookup-finds-no-address": "ENODATA",
    "address-already-in-use-when-listening": "EADDRINUSE",
    "address-not-available": "EADDRNOTAVAIL",
    "host-unreachable": "EHOSTUNREACH",
    "connection-aborted": "ECONNABORTED",
    "file-in-use": "EBUSY",
    "directory-not-empty": "ENOTEMPTY",
    "parent-directory-missing": "ENOENT",
    "parent-is-not-a-directory": "ENOTDIR",
    "path-not-found": "ENOENT",
    "program-not-found": "ENOENT",
    "output-past-the-limit": "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    "source-not-found": "ENOENT",
    "destination-is-a-non-empty-directory": "ENOTEMPTY",
    "destination-is-a-directory": "EISDIR",
    "across-filesystems": "EXDEV",
    "not-permitted": "EPERM",
    "length-cannot-be-read": "EIO",
    "resize-past-the-size-limit": "EFBIG",
    "sync-fails": "EIO",
    "sync-out-of-space": "ENOSPC",
    "current-directory-was-deleted": "ENOENT",
    "change-to-a-missing-directory": "ENOENT",
    "user-has-no-entry": "ENOENT",
};

// How Node words each code and the number it gives it, for the codes the simulated effects use.
// The numbers are Linux's, which is what Node reports on the machines Faultline runs on, so an
// error reads the same on every run.
const codeDetails: Record<string, { errno: number; words: string }> = {
    EPERM: { errno: -1, words: "operation not permitted" },
    ENOENT: { errno: -2, words: "no such file or directory" },
    EIO: { errno: -5, words: "i/o error" },
    EBADF: { errno: -9, words: "bad file descriptor" },
    EACCES: { errno: -13, words: "permission denied" },
    EBUSY: { errno: -16, words: "resource busy or locked" },
    EEXIST: { errno: -17, words: "file already exists" },
    EXDEV: { errno: -18, words: "cross-device link not permitted" },
    ENOTDIR: { errno: -20, words: "not a directory" },
    EISDIR: { errno: -21, words: "illegal operation on a directory" },
    EINVAL: { errno: -22, words: "invalid argument" },
    EMFILE: { errno: -24, words: "too many open files" },
    EFBIG: { errno: -27, words: "file too large" },
    ENOSPC: { errno: -28, words: "no space left on device" },
    EROFS: { errno: -30, words: "read-only file system" },
    EPIPE: { errno: -32, words: "broken pipe" },
    ENAMETOOLONG: { errno: -36, words: "name too long" },
    ENOTEMPTY: { errno: -39, words: "directory not empty" },
    ELOOP: { errno: -40, words: "too many symbolic links encountered" },
    EADDRINUSE: { errno: -98, words: "address already in use" },
    EADDRNOTAVAIL: { errno: -99, words: "address not available" },
    ENETUNREACH: { errno: -101, words: "network is unreachable" },
    ECONNABORTED: { errno: -103, words: "software caused connection abort" },
    ECONNRESET: { errno: -104, words: "connection reset by peer" },
    ETIMEDOUT: { errno: -110, words: "connection timed out" },
    ECONNREFUSED: { errno: -111, words: "connection refused" },
    EHOSTUNREACH: { errno: -113, words: "host is unreachable" },
    EDQUOT: { errno: -122, words: "disk quota exceeded" },
};

// The code a failure id fails with. Asking for a failure that fails some other way is a mistake in
// the effect that asked.
export function codeOf(failure: string): string {
    const code = codesByFailure[failure];
    if (code === undefined) {
        throw new Error(`The failure "${failure}" fails with no code.`);
    }
    return code;
}

// Whether a failure id fails with a code, so an effect can tell a failure it throws from one it
// carries out some other way.
export function hasCode(failure: string): boolean {
    return codesByFailure[failure] !== undefined;
}

// An error carrying the properties Node puts on a failed system call, so code under test that reads
// them reads what it would read in production.
export class CodedError extends Error {
    // The code a caller switches on, for example "ENOENT".
    readonly code: string;

    // The negative number Node gives the code, or none for a code the name lookup gives.
    readonly errno: number | undefined;

    // The system call that failed, for example "open".
    readonly syscall: string | undefined;

    // The path the call was given, for a filesystem call.
    readonly path: string | undefined;

    // The second path, for a call that takes two, such as a rename.
    readonly dest: string | undefined;

    constructor(code: string, message: string, syscall?: string, path?: string, dest?: string) {
        super(message);
        this.name = "Error";
        this.code = code;
        this.errno = codeDetails[code]?.errno;
        this.syscall = syscall;
        this.path = path;
        this.dest = dest;
    }
}

// The error a filesystem call fails with, worded as Node words it: `ENOENT: no such file or
// directory, open '/missing'`.
export function fileError(code: string, syscall: string, path: string, dest?: string): CodedError {
    const words = codeDetails[code]?.words ?? code.toLowerCase();
    const where = dest === undefined ? `'${path}'` : `'${path}' -> '${dest}'`;
    return new CodedError(code, `${code}: ${words}, ${syscall} ${where}`, syscall, path, dest);
}

// The error a network call fails with, worded as Node words it: `connect ECONNREFUSED example.com`
// or `getaddrinfo ENOTFOUND example.com`.
export function networkError(code: string, syscall: string, host: string): CodedError {
    return new CodedError(code, `${syscall} ${code} ${host}`, syscall);
}

// The error a call given an `AbortSignal` fails with when the signal is aborted, with the name and
// the code Node gives it.
export function abortError(): Error {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    Object.defineProperty(error, "code", {
        value: "ABORT_ERR",
        enumerable: true,
    });
    return error;
}
