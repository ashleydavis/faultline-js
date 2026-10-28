# CLAUDE.md

Instructions for an agent working in this repository. This doc is not for humans. Use one line per rule.

## The toolchain

Install it with `mise install`, then type every command in `docs/DEVELOPMENT.md` as it is written.

## Vocabulary

Use these terms consistently in code, docs and output.

- Value factory: an exported function in a `.sim.ts` file that builds a value of one of your own types that Faultline cannot instantiate.
- Fault testing: Faultline's own calls with chosen inputs and injected failures.
- Fault testing scenario, or scenario: a function you write that calls your code with chosen inputs. It takes a `ScenarioContext`.
- Expectation function: a function that checks expectations after a call or a scenario. It takes an `ExpectationContext`.

## The hook

Never edit the pre-commit hook itself (`.githooks/pre-commit`). Every script it runs, and every test, is code like any other and is changed when the work needs it.

## Commits

Update the documentation in the same commit as the change it describes.

## Writing

Print one checklist line per thing the user has to do, each a sentence carrying the file and line: write a scenario, write a value factory for a type Faultline cannot instantiate.

Never use these words: "exploration"; credibility framing such as "honestly", "frankly", "clearly", "actually" and "plainly"; and meaningless causes for a mistake such as "habit", "instinct", "reflex" and "muscle memory".

## Code

Write TypeScript for the tool and shell for the scripts and nothing else.

Import a type with `import type` and name every relative import with its extension.

Never write source code inside strings in the tool's own code. Code the tool adds to a project file it loads is built with the TypeScript compiler's node factory, never as text.

The code under test reaches only the simulated world.

## The contract

Never edit `docs/CONTRACT.md` unless the human explicitly asks for the change.

When the code does not do what the contract says, change the code.

## Naming

A name is wrong when the comment above it says something the name could have: if the comment starts by correcting the name, rename it.
