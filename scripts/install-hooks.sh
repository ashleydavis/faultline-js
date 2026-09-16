#!/usr/bin/env bash
#
# Points this clone's hooks at the ones kept in the repository.
#
# Run it once in every fresh clone, before committing.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
    cat <<'TEXT'
install-hooks.sh points this clone's hooks at the ones kept in the repository.

Usage:
  bash scripts/install-hooks.sh          Put the hooks in place.
  bash scripts/install-hooks.sh --help   Print this and stop.
TEXT
}

if [[ "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

cd "$here" || exit 1
chmod +x .githooks/*
if ! git config core.hooksPath .githooks; then
    printf 'The hooks path could not be set. Is this a git repository?\n'
    exit 1
fi
printf 'The hooks are in place. A commit now runs scripts/test-everything.sh first.\n'
