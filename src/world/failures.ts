// Every failure Faultline injects, grouped by what a function is using. This is the table in
// `docs/FAILURES.md` as code: a test compares the two, so a row cannot be added to one and left out
// of the other.
//
// An id is what a replay token names a failure as, and an effect name is what it names a group as.
// Neither changes once a replay token may carry it, so one is renamed only together with a change
// to what reads the token.

// The groups of `docs/FAILURES.md`, one per heading, in the order the document has them.
export type Effect =
    | "file-open"
    | "read"
    | "write"
    | "link"
    | "directory-listing"
    | "network"
    | "clock"
    | "delete"
    | "make-directory"
    | "resolve-path"
    | "standard-stream"
    | "spawn"
    | "environment"
    | "cancellation"
    | "rename-copy"
    | "attributes"
    | "file-state"
    | "random"
    | "current-directory"
    | "machine"
    | "function-passed-in";

// One way a call can fail: one row of the table.
export interface FailureKind {
    // What a replay token names this failure as.
    id: string;

    // The "Failure" column of the table: what goes wrong.
    description: string;

    // The "What the call does" column of the table, written exactly as the document has it.
    outcome: string;
}

// One group of the table: the failures of one effect under its heading.
export interface FailureGroup {
    // The effect the group is for.
    effect: Effect;

    // The heading the group sits under in `docs/FAILURES.md`.
    heading: string;

    // The rows under that heading, in the order the document has them.
    kinds: FailureKind[];
}

// The whole table, group by group in the order of the document.
export const failureGroups: FailureGroup[] = [
    {
        effect: "file-open",
        heading: "File open, create and check",
        kinds: [
            { id: "file-not-found", description: "File not found", outcome: "fails with `ENOENT`" },
            { id: "access-denied", description: "Access denied", outcome: "fails with `EACCES`" },
            { id: "is-a-directory", description: "Is a directory", outcome: "fails with `EISDIR`" },
            { id: "not-a-directory", description: "Not a directory", outcome: "fails with `ENOTDIR`" },
            { id: "already-exists", description: "Already exists", outcome: "fails with `EEXIST` when creating exclusively" },
            { id: "name-too-long", description: "Name too long", outcome: "fails with `ENAMETOOLONG`" },
            { id: "symlink-loop", description: "Symlink loop", outcome: "fails with `ELOOP`" },
            { id: "out-of-space", description: "Out of space", outcome: "fails with `ENOSPC`" },
            { id: "read-only-filesystem", description: "Read-only filesystem", outcome: "fails with `EROFS`" },
            { id: "too-many-open-files", description: "Too many open files", outcome: "fails with `EMFILE`" },
        ],
    },
    {
        effect: "read",
        heading: "Read",
        kinds: [
            { id: "input-or-output-error", description: "Input or output error", outcome: "fails with `EIO`" },
            { id: "short-read", description: "Short read", outcome: "fewer bytes than asked for, then the rest on the next read" },
            { id: "early-end-of-stream", description: "Early end of stream", outcome: "a read stream ends before the file's length" },
            { id: "read-of-a-directory", description: "Read of a directory", outcome: "fails with `EISDIR`" },
        ],
    },
    {
        effect: "write",
        heading: "Write",
        kinds: [
            { id: "out-of-space", description: "Out of space", outcome: "fails with `ENOSPC`" },
            { id: "input-or-output-error", description: "Input or output error", outcome: "fails with `EIO`" },
            { id: "short-write", description: "Short write", outcome: "fewer bytes accepted than offered" },
            { id: "quota-exceeded", description: "Quota exceeded", outcome: "fails with `EDQUOT`" },
            { id: "read-only-filesystem", description: "Read-only filesystem", outcome: "fails with `EROFS`" },
        ],
    },
    {
        effect: "link",
        heading: "Symlink and link operations",
        kinds: [
            { id: "create-over-an-existing-path", description: "Create over an existing path", outcome: "fails with `EEXIST`" },
            { id: "create-without-permission", description: "Create without permission", outcome: "fails with `EACCES`" },
            { id: "create-in-a-missing-directory", description: "Create in a missing directory", outcome: "fails with `ENOENT`" },
            { id: "out-of-space", description: "Out of space", outcome: "fails with `ENOSPC`" },
            { id: "read-a-link-that-is-not-a-link", description: "Read a link that is not a link", outcome: "fails with `EINVAL`" },
            { id: "read-a-link-that-is-missing", description: "Read a link that is missing", outcome: "fails with `ENOENT`" },
            { id: "dangling-link", description: "Dangling link", outcome: "a link whose target is not there, so opening it fails with `ENOENT`" },
            { id: "link-loop", description: "Link loop", outcome: "a chain of links that returns to itself, so following it fails with `ELOOP`" },
            { id: "remove-a-link-that-is-missing", description: "Remove a link that is missing", outcome: "fails with `ENOENT`" },
            { id: "hard-link-across-filesystems", description: "Hard link across filesystems", outcome: "fails with `EXDEV`" },
        ],
    },
    {
        effect: "directory-listing",
        heading: "Directory listing",
        kinds: [
            { id: "open-a-missing-directory", description: "Open a missing directory", outcome: "fails with `ENOENT`" },
            { id: "open-a-file-as-a-directory", description: "Open a file as a directory", outcome: "fails with `ENOTDIR`" },
            { id: "access-denied", description: "Access denied", outcome: "fails with `EACCES`" },
            { id: "error-part-way-through-the-listing", description: "Error part way through the listing", outcome: "fails with `EIO` from a later `Dir.read`, after some entries were returned" },
            { id: "empty-directory", description: "Empty directory", outcome: "a listing with no entries" },
            { id: "too-many-open-files", description: "Too many open files", outcome: "fails with `EMFILE`" },
        ],
    },
    {
        effect: "network",
        heading: "Network",
        kinds: [
            { id: "name-does-not-resolve", description: "Name does not resolve", outcome: "fails with `ENOTFOUND`" },
            { id: "connection-refused", description: "Connection refused", outcome: "fails with `ECONNREFUSED`" },
            { id: "connection-times-out", description: "Connection times out", outcome: "fails with `ETIMEDOUT`" },
            { id: "network-unreachable", description: "Network unreachable", outcome: "fails with `ENETUNREACH`" },
            { id: "connection-reset-part-way-through", description: "Connection reset part way through", outcome: "fails with `ECONNRESET` from a later read or write" },
            { id: "short-response", description: "Short response", outcome: "the response ends before the length its `content-length` header gave" },
            { id: "response-that-does-not-parse", description: "Response that does not parse", outcome: "a body that is not what the protocol allows" },
            { id: "server-error", description: "Server error", outcome: "an HTTP response with status 500" },
            { id: "name-server-fails", description: "Name server fails", outcome: "fails with `ESERVFAIL`" },
            { id: "host-lookup-finds-no-address", description: "Host lookup finds no address", outcome: "fails with `ENODATA`" },
            { id: "address-already-in-use-when-listening", description: "Address already in use when listening", outcome: "fails with `EADDRINUSE`" },
            { id: "address-not-available", description: "Address not available", outcome: "fails with `EADDRNOTAVAIL`" },
            { id: "host-unreachable", description: "Host unreachable", outcome: "fails with `EHOSTUNREACH`" },
            { id: "connection-aborted", description: "Connection aborted", outcome: "fails with `ECONNABORTED`" },
        ],
    },
    {
        effect: "clock",
        heading: "Clock",
        kinds: [
            { id: "time-goes-backwards", description: "Time goes backwards", outcome: "a reading earlier than the previous one" },
            { id: "time-stands-still", description: "Time stands still", outcome: "the same reading on every call" },
            { id: "time-jumps-far-forward", description: "Time jumps far forward", outcome: "a reading far past the previous one" },
        ],
    },
    {
        effect: "delete",
        heading: "Delete",
        kinds: [
            { id: "file-not-found", description: "File not found", outcome: "fails with `ENOENT`" },
            { id: "access-denied", description: "Access denied", outcome: "fails with `EACCES`" },
            { id: "file-in-use", description: "File in use", outcome: "fails with `EBUSY`" },
            { id: "is-a-directory", description: "Is a directory", outcome: "fails with `EISDIR`" },
            { id: "not-a-directory", description: "Not a directory", outcome: "fails with `ENOTDIR`" },
            { id: "directory-not-empty", description: "Directory not empty", outcome: "fails with `ENOTEMPTY`" },
            { id: "symlink-loop", description: "Symlink loop", outcome: "fails with `ELOOP`" },
            { id: "read-only-filesystem", description: "Read-only filesystem", outcome: "fails with `EROFS`" },
            { id: "error-part-way-through-deleting-a-tree", description: "Error part way through deleting a tree", outcome: "an error from deleting one entry, after earlier entries were deleted" },
        ],
    },
    {
        effect: "make-directory",
        heading: "Create a directory",
        kinds: [
            { id: "already-exists", description: "Already exists", outcome: "fails with `EEXIST`" },
            { id: "access-denied", description: "Access denied", outcome: "fails with `EACCES`" },
            { id: "parent-directory-missing", description: "Parent directory missing", outcome: "fails with `ENOENT`" },
            { id: "parent-is-not-a-directory", description: "Parent is not a directory", outcome: "fails with `ENOTDIR`" },
            { id: "out-of-space", description: "Out of space", outcome: "fails with `ENOSPC`" },
            { id: "quota-exceeded", description: "Quota exceeded", outcome: "fails with `EDQUOT`" },
            { id: "read-only-filesystem", description: "Read-only filesystem", outcome: "fails with `EROFS`" },
        ],
    },
    {
        effect: "resolve-path",
        heading: "Resolve a path",
        kinds: [
            { id: "path-not-found", description: "Path not found", outcome: "fails with `ENOENT`" },
            { id: "not-a-directory", description: "Not a directory", outcome: "fails with `ENOTDIR`" },
            { id: "access-denied", description: "Access denied", outcome: "fails with `EACCES`" },
            { id: "symlink-loop", description: "Symlink loop", outcome: "fails with `ELOOP`" },
            { id: "name-too-long", description: "Name too long", outcome: "fails with `ENAMETOOLONG`" },
        ],
    },
    {
        effect: "standard-stream",
        heading: "Standard input, output and error",
        kinds: [
            { id: "input-closed", description: "Input closed", outcome: "the input ends with no data" },
            { id: "input-or-output-error", description: "Input or output error", outcome: "the stream emits `error` with `EIO`" },
            { id: "output-closed", description: "Output closed", outcome: "the stream emits `error` with `EPIPE`" },
            { id: "short-write", description: "Short write", outcome: "`write` returns `false` and `drain` is emitted later" },
        ],
    },
    {
        effect: "spawn",
        heading: "Running another program",
        kinds: [
            { id: "program-not-found", description: "Program not found", outcome: "fails with `ENOENT`" },
            { id: "access-denied", description: "Access denied", outcome: "fails with `EACCES`" },
            { id: "too-many-open-files", description: "Too many open files", outcome: "fails with `EMFILE`" },
            { id: "exits-with-a-non-zero-code", description: "Exits with a non-zero code", outcome: "the program exits with a non-zero code" },
            { id: "killed-by-a-signal", description: "Killed by a signal", outcome: "the program exits with a signal" },
            { id: "output-past-the-limit", description: "Output past the limit", outcome: "fails with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`" },
            { id: "timed-out", description: "Timed out", outcome: "the program is killed when the timeout the caller set runs out" },
        ],
    },
    {
        effect: "environment",
        heading: "Environment variables",
        kinds: [
            { id: "variable-not-set", description: "Variable not set", outcome: "the read returns `undefined`" },
            { id: "variable-set-to-an-empty-value", description: "Variable set to an empty value", outcome: "the read returns `\"\"`" },
        ],
    },
    {
        effect: "cancellation",
        heading: "Cancellation",
        kinds: [
            { id: "operation-aborted", description: "Operation aborted", outcome: "a call given an `AbortSignal` fails with an `AbortError`" },
        ],
    },
    {
        effect: "rename-copy",
        heading: "Rename and copy",
        kinds: [
            { id: "source-not-found", description: "Source not found", outcome: "fails with `ENOENT`" },
            { id: "access-denied", description: "Access denied", outcome: "fails with `EACCES`" },
            { id: "destination-is-a-non-empty-directory", description: "Destination is a non-empty directory", outcome: "fails with `ENOTEMPTY`" },
            { id: "destination-is-a-directory", description: "Destination is a directory", outcome: "fails with `EISDIR`" },
            { id: "file-in-use", description: "File in use", outcome: "fails with `EBUSY`" },
            { id: "across-filesystems", description: "Across filesystems", outcome: "fails with `EXDEV`" },
            { id: "out-of-space", description: "Out of space", outcome: "fails with `ENOSPC`" },
            { id: "quota-exceeded", description: "Quota exceeded", outcome: "fails with `EDQUOT`" },
            { id: "read-only-filesystem", description: "Read-only filesystem", outcome: "fails with `EROFS`" },
            { id: "copy-fails-part-way-through", description: "Copy fails part way through", outcome: "an error from reading or writing, after some bytes were copied" },
        ],
    },
    {
        effect: "attributes",
        heading: "Change permissions, owner or timestamps",
        kinds: [
            { id: "access-denied", description: "Access denied", outcome: "fails with `EACCES`" },
            { id: "not-permitted", description: "Not permitted", outcome: "fails with `EPERM`" },
            { id: "file-not-found", description: "File not found", outcome: "fails with `ENOENT`" },
            { id: "input-or-output-error", description: "Input or output error", outcome: "fails with `EIO`" },
            { id: "read-only-filesystem", description: "Read-only filesystem", outcome: "fails with `EROFS`" },
            { id: "symlink-loop", description: "Symlink loop", outcome: "fails with `ELOOP`" },
        ],
    },
    {
        effect: "file-state",
        heading: "File length and sync",
        kinds: [
            { id: "length-cannot-be-read", description: "Length cannot be read", outcome: "fails with `EIO`" },
            { id: "resize-past-the-size-limit", description: "Resize past the size limit", outcome: "fails with `EFBIG`" },
            { id: "sync-fails", description: "Sync fails", outcome: "fails with `EIO`" },
            { id: "sync-out-of-space", description: "Sync out of space", outcome: "fails with `ENOSPC`" },
        ],
    },
    {
        effect: "random",
        heading: "Secure random numbers",
        kinds: [
            { id: "no-entropy-available", description: "No entropy available", outcome: "`crypto.randomBytes` with a callback passes it an `Error`" },
        ],
    },
    {
        effect: "current-directory",
        heading: "Current directory",
        kinds: [
            { id: "current-directory-was-deleted", description: "Current directory was deleted", outcome: "`process.cwd` fails with `ENOENT`" },
            { id: "change-to-a-missing-directory", description: "Change to a missing directory", outcome: "`process.chdir` fails with `ENOENT`" },
        ],
    },
    {
        effect: "machine",
        heading: "The machine",
        kinds: [
            { id: "user-has-no-entry", description: "User has no entry", outcome: "`os.userInfo` fails with `ENOENT`" },
        ],
    },
    {
        effect: "function-passed-in",
        heading: "Functions passed in",
        kinds: [
            { id: "throws", description: "Throws", outcome: "the function throws an `Error`" },
            { id: "rejects", description: "Rejects", outcome: "the function returns a promise that rejects with an `Error`, when its return type is a promise" },
        ],
    },
];

// The ids of every failure an effect can be given, in the order of the table. An effect call that
// can fail every way its group lists passes this as the failures possible at its place.
export function failureIdsOf(effect: Effect): string[] {
    for (const group of failureGroups) {
        if (group.effect === effect) {
            return group.kinds.map((kind) => kind.id);
        }
    }
    throw new Error(`The failure table has no group for the effect "${effect}".`);
}

// Whether a failure id names one of an effect's own rows, so a plan naming a failure the effect has
// no row for is refused rather than never happening.
export function isFailureOf(effect: Effect, failure: string): boolean {
    return failureIdsOf(effect).includes(failure);
}
