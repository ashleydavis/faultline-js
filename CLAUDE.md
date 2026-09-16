# CLAUDE.md

Instructions for an agent working in this repository. This doc is not for humans. Use one line per rule. Never pad this file or add unecessary filler.

## The toolchain

Node 22.6 or later, because the tool and its tests are TypeScript that Node runs directly. Install with `npm install`, then type every command in `docs/DEVELOPMENT.md` as it is written.

## Tests

Every function must be comprehensively covered by automated tests.

Put every test in `<name>.test.ts` beside the source, never in the source file itself.

Never skip, disable or weaken a test.

Run the narrowest suite that covers your change first, then `bash scripts/test-everything.sh` before committing.

An example under `examples/working` has to exit 0 and one under `examples/non-working` has to exit 1, and both have their whole output compared against `expected.txt`.

Run `bash scripts/smoke.sh --record` only when a change to the report is meant, and read every diff it writes before committing it.

## The hook

Run `bash scripts/install-hooks.sh` in every fresh clone before committing.

Never bypass or edit the pre-commit hook, or the scripts it calls. When it refuses a commit, fix what failed and commit again.

## Commits

The subject line says what was done. The description says why, what was tried and rejected, and any measurement with the conditions it was taken under. Never restate the diff in prose.

Update the documentation in the same commit as the change it describes.

## Writing

Every message the tool prints reads as a proper sentence: a capital letter at the start and a full stop at the end.

Print one checklist line per thing the user has to do, each a sentence carrying the file and line: write a test input factory, write a scenario, export a class.

Write one line per paragraph or bullet, with no hard wrapping, no `---` rules and no em dashes.

No jargon, no filler, no made up examples.

Never commit an absolute path, a secret or a personal detail.

Never use these words: "shape"; "gate", "gated", "gating", "ungated"; credibility framing such as "honestly", "frankly", "clearly", "actually" and "plainly"; and meaningless causes for a mistake such as "habit", "instinct", "reflex" and "muscle memory".

Never write "nothing" or "nobody" in the documentation. Name the thing that is absent: "no factory", "no call reached it", "no list refers to it".

## Code

Write TypeScript for the tool and shell for the scripts, and nothing else.

Every source file is TypeScript that Node runs without a build, so write nothing `--experimental-strip-types` refuses: no enum, no namespace, no parameter property, no decorator. `erasableSyntaxOnly` is on and catches these.

Import a type with `import type`, and name every relative import with its extension.

Give every shell script `#!/usr/bin/env bash`, a `.sh` extension, the executable bit staged with `git add --chmod=+x`, `bash -n` run over it, and usage printed when it is run with `--help`.

Comment every exported symbol and every field of an exported type.

Write beside every named constant why its value is what it is.

Use 4-space indentation, braces on the same line, and `else` and `catch` on a new line.

Never write an `if` or an `else` without braces. Every body goes on its own lines, whatever it does and however short it is: a bare `continue`, a `return`, a `break`.

## What the tool may never do

Never write into the repository being measured. Everything a run generates goes under the system's temporary directory.

Never ask a project being measured to import anything, declare anything or pass anything. A file being measured is untouched, and V8 is what counts.

Never put counting into the copy. V8 counts, and the source map the transpile writes is what turns a place it reports into a line somebody wrote.

## The contract

`docs/CONTRACT.md` is the human's. Never edit it, and never add to it, unless the human asks for that change in the message you are acting on.

Told to make the code match it, change the code. Editing the contract to describe what the code does inverts the one line at the top of it, which says the file is right and the behaviour is the defect.

Where the code cannot meet it, say so and stop. Do not write an exemption into it, and never record that the human asked for something they did not.
