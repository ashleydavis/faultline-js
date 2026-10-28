# Failure types Faultline injects

These are the failures Faultline injects, grouped by what the function is using: files, directories, the network, the clock, random numbers, output, other programs, environment variables and functions passed in. Each failure lists what the failing call does to your code. Every time Faultline calls a function, it notes each call inside it that can fail. For each of those calls and each failure that applies to it, Faultline calls the function again with only that one failure injected. These calls can reach new calls that can fail and Faultline does the same for them.

Faultline replaces these with simulated ones for every file it loads, your packages in `node_modules` included: the modules `node:fs`, `node:fs/promises`, `node:dns`, `node:dns/promises`, `node:http`, `node:https`, `node:net`, `node:child_process`, `node:os` and the random parts of `node:crypto`, and `fetch`, `Date`, `performance.now`, `Math.random`, `crypto.randomUUID`, `crypto.getRandomValues`, the timers, `process.env`, `process.argv`, `process.exit`, `process.stdin`, `process.stdout`, `process.stderr` and `console`.

Each call has its own `process.argv`: it starts as the process's, and a change one call makes is not seen by the next. `process.exitCode` is cleared at the start of every call, as it starts unset in a new process, and `process.exit()` with no code ends with the code `process.exitCode` holds.

A failing call fails the way the real one does. A filesystem call throws, rejects or passes to its callback an `Error` with the `code`, `syscall` and `path` the real call would give, in its synchronous, callback and promise forms alike. A failing `fetch` rejects with a `TypeError` whose `cause` carries the code, as Node's own `fetch` does.

## File open, create and check

| Failure | What the call does |
| --- | --- |
| File not found | fails with `ENOENT` |
| Access denied | fails with `EACCES` |
| Is a directory | fails with `EISDIR` |
| Not a directory | fails with `ENOTDIR` |
| Already exists | fails with `EEXIST` when creating exclusively |
| Name too long | fails with `ENAMETOOLONG` |
| Symlink loop | fails with `ELOOP` |
| Out of space | fails with `ENOSPC` |
| Read-only filesystem | fails with `EROFS` |
| Too many open files | fails with `EMFILE` |

The simulated filesystem starts empty. A scenario writes the files a call needs.

## Read

| Failure | What the call does |
| --- | --- |
| Input or output error | fails with `EIO` |
| Short read | fewer bytes than asked for, then the rest on the next read |
| Early end of stream | a read stream ends before the file's length |
| Read of a directory | fails with `EISDIR` |

## Write

| Failure | What the call does |
| --- | --- |
| Out of space | fails with `ENOSPC` |
| Input or output error | fails with `EIO` |
| Short write | fewer bytes accepted than offered |
| Quota exceeded | fails with `EDQUOT` |
| Read-only filesystem | fails with `EROFS` |

## Symlink and link operations

| Failure | What the call does |
| --- | --- |
| Create over an existing path | fails with `EEXIST` |
| Create without permission | fails with `EACCES` |
| Create in a missing directory | fails with `ENOENT` |
| Out of space | fails with `ENOSPC` |
| Read a link that is not a link | fails with `EINVAL` |
| Read a link that is missing | fails with `ENOENT` |
| Dangling link | a link whose target is not there, so opening it fails with `ENOENT` |
| Link loop | a chain of links that returns to itself, so following it fails with `ELOOP` |
| Remove a link that is missing | fails with `ENOENT` |
| Hard link across filesystems | fails with `EXDEV` |

## Directory listing

| Failure | What the call does |
| --- | --- |
| Open a missing directory | fails with `ENOENT` |
| Open a file as a directory | fails with `ENOTDIR` |
| Access denied | fails with `EACCES` |
| Error part way through the listing | fails with `EIO` from a later `Dir.read`, after some entries were returned |
| Empty directory | a listing with no entries |
| Too many open files | fails with `EMFILE` |

Listings come back sorted, so a replay lists the same way.

## Network

| Failure | What the call does |
| --- | --- |
| Name does not resolve | fails with `ENOTFOUND` |
| Connection refused | fails with `ECONNREFUSED` |
| Connection times out | fails with `ETIMEDOUT` |
| Network unreachable | fails with `ENETUNREACH` |
| Connection reset part way through | fails with `ECONNRESET` from a later read or write |
| Short response | the response ends before the length its `content-length` header gave |
| Response that does not parse | a body that is not what the protocol allows |
| Server error | an HTTP response with status 500 |
| Name server fails | fails with `ESERVFAIL` |
| Host lookup finds no address | fails with `ENODATA` |
| Address already in use when listening | fails with `EADDRINUSE` |
| Address not available | fails with `EADDRNOTAVAIL` |
| Host unreachable | fails with `EHOSTUNREACH` |
| Connection aborted | fails with `ECONNABORTED` |

Unless a failure is injected, a connection is accepted and the other end sends no data, and an HTTP request gets status 200 and an empty body. A server the code under test or a scenario starts listens on a port of the run's network, and an HTTP request or `fetch` the run makes to that port on this machine (`localhost`, `127.0.0.1` or `::1`) reaches that server and gets its answer. A scenario stands in for a service this way: it starts a server that answers as the service does and points the code under test at it. Calling `close` on a server that is not listening passes its callback an error with the code `ERR_SERVER_NOT_RUNNING`, as Node does.

## Clock

| Failure | What the call does |
| --- | --- |
| Time goes backwards | a reading earlier than the previous one |
| Time stands still | the same reading on every call |
| Time jumps far forward | a reading far past the previous one |

Timers run in simulated time, in the order they are due, so a call that waits is exercised at once and the clock moves on by the time it waited.

## Delete

| Failure | What the call does |
| --- | --- |
| File not found | fails with `ENOENT` |
| Access denied | fails with `EACCES` |
| File in use | fails with `EBUSY` |
| Is a directory | fails with `EISDIR` |
| Not a directory | fails with `ENOTDIR` |
| Directory not empty | fails with `ENOTEMPTY` |
| Symlink loop | fails with `ELOOP` |
| Read-only filesystem | fails with `EROFS` |
| Error part way through deleting a tree | an error from deleting one entry, after earlier entries were deleted |

## Create a directory

| Failure | What the call does |
| --- | --- |
| Already exists | fails with `EEXIST` |
| Access denied | fails with `EACCES` |
| Parent directory missing | fails with `ENOENT` |
| Parent is not a directory | fails with `ENOTDIR` |
| Out of space | fails with `ENOSPC` |
| Quota exceeded | fails with `EDQUOT` |
| Read-only filesystem | fails with `EROFS` |

## Resolve a path

| Failure | What the call does |
| --- | --- |
| Path not found | fails with `ENOENT` |
| Not a directory | fails with `ENOTDIR` |
| Access denied | fails with `EACCES` |
| Symlink loop | fails with `ELOOP` |
| Name too long | fails with `ENAMETOOLONG` |

## Standard input, output and error

| Failure | What the call does |
| --- | --- |
| Input closed | the input ends with no data |
| Input or output error | the stream emits `error` with `EIO` |
| Output closed | the stream emits `error` with `EPIPE` |
| Short write | `write` returns `false` and `drain` is emitted later |

Output your code writes is kept by Faultline and not shown.

## Running another program

| Failure | What the call does |
| --- | --- |
| Program not found | fails with `ENOENT` |
| Access denied | fails with `EACCES` |
| Too many open files | fails with `EMFILE` |
| Exits with a non-zero code | the program exits with a non-zero code |
| Killed by a signal | the program exits with a signal |
| Output past the limit | fails with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` |
| Timed out | the program is killed when the timeout the caller set runs out |

When the code under test runs another program, Faultline does not run it, so a fault test never changes anything outside the simulated world. The call gets a stand-in for the program that prints no output and exits with code 0, unless one of the failures above is injected. A scenario gives a program other output and another exit code with `context.programs.answer`.

## Environment variables

| Failure | What the call does |
| --- | --- |
| Variable not set | the read returns `undefined` |
| Variable set to an empty value | the read returns `""` |

The simulated environment starts empty. A scenario sets the variables a call needs.

## Cancellation

An interruption reaches a function as an aborted operation.

| Failure | What the call does |
| --- | --- |
| Operation aborted | a call given an `AbortSignal` fails with an `AbortError` |

## Rename and copy

| Failure | What the call does |
| --- | --- |
| Source not found | fails with `ENOENT` |
| Access denied | fails with `EACCES` |
| Destination is a non-empty directory | fails with `ENOTEMPTY` |
| Destination is a directory | fails with `EISDIR` |
| File in use | fails with `EBUSY` |
| Across filesystems | fails with `EXDEV` |
| Out of space | fails with `ENOSPC` |
| Quota exceeded | fails with `EDQUOT` |
| Read-only filesystem | fails with `EROFS` |
| Copy fails part way through | an error from reading or writing, after some bytes were copied |

## Change permissions, owner or timestamps

| Failure | What the call does |
| --- | --- |
| Access denied | fails with `EACCES` |
| Not permitted | fails with `EPERM` |
| File not found | fails with `ENOENT` |
| Input or output error | fails with `EIO` |
| Read-only filesystem | fails with `EROFS` |
| Symlink loop | fails with `ELOOP` |

## File length and sync

| Failure | What the call does |
| --- | --- |
| Length cannot be read | fails with `EIO` |
| Resize past the size limit | fails with `EFBIG` |
| Sync fails | fails with `EIO` |
| Sync out of space | fails with `ENOSPC` |

## Secure random numbers

| Failure | What the call does |
| --- | --- |
| No entropy available | `crypto.randomBytes` with a callback passes it an `Error` |

## Current directory

| Failure | What the call does |
| --- | --- |
| Current directory was deleted | `process.cwd` fails with `ENOENT` |
| Change to a missing directory | `process.chdir` fails with `ENOENT` |

## The machine

| Failure | What the call does |
| --- | --- |
| User has no entry | `os.userInfo` fails with `ENOENT` |

## Functions passed in

A function Faultline builds and passes to your code, as an argument or as a property of an argument.

| Failure | What the call does |
| --- | --- |
| Throws | the function throws an `Error` |
| Rejects | the function returns a promise that rejects with an `Error`, when its return type is a promise |
