# test-everything.sh

Runs the checks a change affects, several at a time, and stops at the first one that fails. It asks what-changed which targets in `what-changed.yaml` the change falls under, so a documentation-only change runs no check. Each target records its what-changed baseline when it passes. Logs go to `tmp/test-everything/`.

The targets are `build` (`bun run build`), `test` (`bun run test`) and `smoke` (`bash scripts/smoke.sh`).

## Usage

```sh
bash scripts/test-everything.sh [--force] [--plan] [--help] [target...]
```

- No arguments: prints the usage, then runs the targets that changed.
- `target...`: runs exactly those targets, whatever changed. Use this when the directory has no git history for what-changed to read.
- `--force`: runs every target.
- `--plan`: prints which targets it would run and runs none.
- `--help`: prints the usage and stops.
