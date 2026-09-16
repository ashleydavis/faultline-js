#!/usr/bin/env bash
#
# Runs flt against every example and compares what it printed with what was captured.
#
# An example under examples/working has to come back green, and one under examples/non-working has
# to come back red. Both have their whole output compared, so a change to a single line of the
# report is seen here before anybody reads it.

set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
    cat <<'TEXT'
smoke.sh runs flt against every example and compares what it printed with what was captured.

Usage:
  bash scripts/smoke.sh [name ...]   Run every example, or only the ones named.
  bash scripts/smoke.sh --shard 1/3  Run one third of them, for one runner of three.
  bash scripts/smoke.sh --record     Run every example and write down what it printed.
  bash scripts/smoke.sh --help       Print this and stop.

An example under examples/working has to exit 0, and one under examples/non-working has to exit 1.
TEXT
}

# Takes out the lines that differ between two runs of the same example: the directory the run
# generated its work in, how long it took, and the counts that move as a machine goes faster.
normalise() {
    sed -E \
        -e "s#/tmp/faultline-[^/ ]+#<work>#g" \
        -e "s/Took [0-9]+m? ?[0-9]*s\./Took <time>./" \
        -e "s/, [0-9]+ calls/, <calls> calls/" \
        -e "s/, [0-9]+ call$/, <calls> call/" \
        -e "s/Stepped over [0-9]+ calls?/Stepped over <count> calls/" \
        -e "s/stopped [0-9]+ units? that ran/stopped <count> units that ran/" \
        -e "s/Exercised [0-9]+ of [0-9]+ units\./Exercised <count> units./"
}

# Runs one example and says whether it came back the way it was captured.
run_one() {
    local directory="$1"
    local recording="$2"
    local name
    name="$(basename "$directory")"
    local wanted_status=0
    if [[ "$directory" == *"/non-working/"* ]]; then
        wanted_status=1
    fi
    # An example that ends some other way says so, which is how the one that refuses an option says
    # it exits 2 rather than 1: it measured no code at all.
    if [[ -f "$directory/status.txt" ]]; then
        wanted_status="$(cat "$directory/status.txt")"
    fi

    # Each example resolves `faultline` the way a real project does, through node_modules. The link
    # is made here rather than committed, because what it points at depends on where the clone is.
    if [[ ! -e "$directory/node_modules/faultline" ]]; then
        mkdir -p "$directory/node_modules"
        ln -sfn "$here" "$directory/node_modules/faultline"
    fi

    # An example that needs a browser is left out where there is none, rather than failing on a
    # machine that has no reason to have one installed.
    if [[ -f "$directory/run-flags.txt" ]] && grep -q -- "--browser" "$directory/run-flags.txt"; then
        if ! (cd "$here" && node --input-type=module -e "
            import fs from 'node:fs';
            const named = process.env.FAULTLINE_CHROMIUM;
            if (named !== undefined && fs.existsSync(named)) { process.exit(0); }
            const { chromium } = await import('playwright');
            process.exit(fs.existsSync(chromium.executablePath()) ? 0 : 1);
        ") >/dev/null 2>&1; then
            printf 'skip %s, because this machine has no browser to run it in.\n' "$name"
            return 0
        fi
    fi

    local flags=()
    if [[ -f "$directory/run-flags.txt" ]]; then
        # shellcheck disable=SC2207
        flags=($(cat "$directory/run-flags.txt"))
    fi
    if [[ ${#flags[@]} -eq 0 ]]; then
        flags=(--seeds 16)
    fi

    local printed status
    printed="$(cd "$directory" && node "$here/bin/flt.mjs" . "${flags[@]}" 2>&1)"
    status=$?
    printed="$(printf '%s\n' "$printed" | normalise)"

    if [[ "$status" -ne "$wanted_status" ]]; then
        printf 'FAIL %s exited %s, and it has to exit %s.\n' "$name" "$status" "$wanted_status"
        printf '%s\n' "$printed"
        return 1
    fi

    if [[ "$recording" == "yes" ]]; then
        printf '%s\n' "$printed" > "$directory/expected.txt"
        printf 'Wrote %s.\n' "$name"
        return 0
    fi

    if [[ ! -f "$directory/expected.txt" ]]; then
        printf 'FAIL %s has no expected.txt. Run scripts/smoke.sh --record to write one.\n' "$name"
        return 1
    fi

    if ! diff -u "$directory/expected.txt" <(printf '%s\n' "$printed") > /tmp/flt-smoke-diff.$$ 2>&1; then
        printf 'FAIL %s printed something other than what was captured.\n' "$name"
        cat /tmp/flt-smoke-diff.$$
        rm -f /tmp/flt-smoke-diff.$$
        return 1
    fi
    rm -f /tmp/flt-smoke-diff.$$
    printf 'ok   %s\n' "$name"
    return 0
}

recording="no"
wanted=()
shard_index=1
shard_count=1
take_shard="no"
for argument in "$@"; do
    if [[ "$take_shard" == "yes" ]]; then
        shard_index="${argument%%/*}"
        shard_count="${argument##*/}"
        take_shard="no"
        continue
    fi
    case "$argument" in
        --help)
            usage
            exit 0
            ;;
        --record)
            recording="yes"
            ;;
        --shard)
            take_shard="yes"
            ;;
        *)
            wanted+=("$argument")
            ;;
    esac
done

if [[ ! "$shard_count" =~ ^[0-9]+$ ]] || [[ "$shard_count" -lt 1 ]] || [[ ! "$shard_index" =~ ^[0-9]+$ ]]; then
    printf 'A shard is written as a number and how many there are, such as --shard 1/3.\n'
    exit 1
fi

failed=0
ran=0
seen=0
for directory in "$here"/examples/*/*/; do
    directory="${directory%/}"
    name="$(basename "$directory")"
    # Dealt round the shards in the order they sort, so every runner gets about the same number and
    # the same example lands on the same runner every time.
    seen=$((seen + 1))
    if [[ "$shard_count" -gt 1 ]] && [[ $(((seen - 1) % shard_count + 1)) -ne "$shard_index" ]]; then
        continue
    fi
    if [[ ${#wanted[@]} -gt 0 ]]; then
        found="no"
        for one in "${wanted[@]}"; do
            if [[ "$name" == *"$one"* ]]; then
                found="yes"
            fi
        done
        if [[ "$found" == "no" ]]; then
            continue
        fi
    fi
    ran=$((ran + 1))
    if ! run_one "$directory" "$recording"; then
        failed=$((failed + 1))
    fi
done

if [[ "$ran" -eq 0 ]]; then
    printf 'No example matched what was asked for.\n'
    exit 1
fi

if [[ "$failed" -gt 0 ]]; then
    printf '\n%s of %s examples failed.\n' "$failed" "$ran"
    exit 1
fi

printf '\nAll %s examples passed.\n' "$ran"
