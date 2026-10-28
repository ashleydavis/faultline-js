# install-hooks.sh

Sets this clone's `core.hooksPath` to `.githooks`, so git runs the pre-commit hook kept in the repository. Git never runs a checked-in hooks directory without this, and the setting belongs to the clone, so run it once in every clone.

## Usage

```sh
bash scripts/install-hooks.sh [--help]
```

- No arguments: prints the usage, then sets `core.hooksPath`.
- `--help`: prints the usage and stops, leaving the configuration unchanged.
