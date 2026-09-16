#!/usr/bin/env bash
#
# Runs every suite this repository has, stopping at the first one that fails.
#
# This is what the pre commit hook runs, so what it says is what a commit is allowed on.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
    cat <<'TEXT'
test-everything.sh runs every suite this repository has, stopping at the first one that fails.

Usage:
  bash scripts/test-everything.sh          Run the types, the unit tests and the examples.
  bash scripts/test-everything.sh --help   Print this and stop.
TEXT
}

if [[ "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

cd "$here" || exit 1

printf 'Checking the types.\n'
if ! npx tsc --noEmit; then
    printf 'The types did not check out.\n'
    exit 1
fi

# A project being measured resolves `faultline` through the package's exports, which name what the
# build emitted. Without it the runtime types resolve to nothing and no scenario is found.
printf 'Building.\n'
if ! npm run --silent build; then
    printf 'The build did not come out.\n'
    exit 1
fi

printf 'Running the unit tests.\n'
# The end to end tests start a run of their own, which is slower than a unit test has any right to
# be, so the limit is raised well past what one of them takes.
if ! node --test --test-timeout=600000 "src/**/*.test.ts"; then
    printf 'The unit tests did not pass.\n'
    exit 1
fi

printf 'Running the examples.\n'
if ! bash "$here/scripts/smoke.sh"; then
    printf 'The examples did not pass.\n'
    exit 1
fi

printf '\nEverything passed.\n'
