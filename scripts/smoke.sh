#!/usr/bin/env bash
# Runs the checks that need a real Node process and then Faultline against every example. Then it
# checks what each printed.
#
# A check is a file under src/smoke/ named <name>.smoke.ts, run with the Node on the PATH. It does
# what a unit test cannot: it starts processes, registers the module hooks in a process of its own
# or reads the repository's own files. It exits 0 when it passes and says why when it does not.
#
# Every directory under examples/working/ and examples/non-working/ is a project of its own that the
# tool is run in exactly as it is run in a repository that has never seen it: it declares Faultline
# as a dependency in its own package.json and runs `npx flt`. That is what makes the examples a
# check that the tool needs no wiring before it works.
#
# Each example carries an expected.txt holding what the tool printed, with the lines that vary
# between runs taken out: the elapsed time, the per-function call counts, the seeds and the cache
# paths. A run that prints anything else is a failure, so a change to the output is seen here rather
# than being noticed months later.
#
# Examples run several at a time, because each one is a Node process of its own that spends much of
# its time starting up. How many run at once comes from --parallel <n>, or from PARALLEL when the
# argument is absent, and is DEFAULT_PARALLEL when neither is set. Each example's output is
# collected on its own and printed whole when it finishes, so running several at once never
# interleaves two examples' output.
#
# Usage:
#   bash scripts/smoke.sh                      # every example
#   bash scripts/smoke.sh branch-one-function  # one example or one check, while it is worked on
#   bash scripts/smoke.sh --parallel 1         # one after another, for a run read as it goes
#   bash scripts/smoke.sh --shard 2/6          # this shard's share of the examples, for one runner
#   bash scripts/smoke.sh --help               # print the usage and stop
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_DIR"

# How many examples run at once when nothing says otherwise. Four because a hosted CI runner has
# four cores and each example keeps one busy.
DEFAULT_PARALLEL=4

# Prints how to run the script.
usage() {
    echo "Usage: bash scripts/smoke.sh [--parallel <n>] [--shard <n>/<total>] [smoke-test-name]"
    echo "  With no arguments, runs every smoke test."
}

# Run with no arguments the script prints how to use it, then carries on with every example.
if [ "$#" -eq 0 ]; then
    usage
    echo ""
fi

ONLY=""
SHARD=""
PARALLEL="${PARALLEL:-$DEFAULT_PARALLEL}"

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help)
            usage
            exit 0
            ;;
        --shard)
            shift
            if [ "$#" -eq 0 ]; then
                echo "--shard needs <n>/<total>." >&2
                exit 1
            fi
            SHARD="$1"
            ;;
        --parallel)
            shift
            if [ "$#" -eq 0 ]; then
                echo "--parallel needs a number." >&2
                exit 1
            fi
            PARALLEL="$1"
            ;;
        --*)
            echo "Unknown option \"$1\". Known options: --parallel <n>, --shard <n>/<total>, --help." >&2
            exit 1
            ;;
        *)
            ONLY="$1"
            ;;
    esac
    shift
done

case "$PARALLEL" in
    ''|*[!0-9]*)
        echo "--parallel wants a number, and \"$PARALLEL\" is not one." >&2
        exit 1
        ;;
esac
if [ "$PARALLEL" -lt 1 ]; then
    echo "--parallel wants at least one." >&2
    exit 1
fi

# Every check and every example runs with the Node on the PATH, and Faultline refuses an older Node
# than its package.json names, so there has to be one.
if ! command -v node >/dev/null 2>&1; then
    echo "There is no node on the PATH, and every smoke test is run with it." >&2
    exit 1
fi

# Faultline refuses a Node older than the major version its package.json names, so under one every
# example would fail for that one reason. Saying it once here is clearer than every example failing.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
REQUIRED_MAJOR="$(node -p 'require("./package.json").engines.node.replace(/[^0-9.]/g, "").split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$REQUIRED_MAJOR" ]; then
    echo "The node on the PATH is $(node --version), and Faultline needs Node $REQUIRED_MAJOR or later. Run mise install in this directory, or put a newer Node first on the PATH." >&2
    exit 1
fi

# Every example runs the built command, so the script builds first. A build left over from before
# the last change would test code that is no longer the source.
if ! command -v bun >/dev/null 2>&1; then
    echo "There is no bun on the PATH, and the smoke tests build the tool with it first." >&2
    exit 1
fi
if ! bun run build; then
    echo "The build failed, so there is no up-to-date flt to run. Fix what tsc said and try again." >&2
    exit 1
fi

FLT_FILE="$REPO_DIR/dist/bin/flt.js"
if [ ! -f "$FLT_FILE" ]; then
    echo "There is no $FLT_FILE, so there is no flt to run. Run bun run build and try again." >&2
    exit 1
fi

# A package manager marks a package's command as a program when it installs it, and the compiler
# does not, so the script does what the install would have.
chmod +x "$FLT_FILE"

EXAMPLES=()
for KIND in working non-working; do
    if [ ! -d "examples/$KIND" ]; then
        continue
    fi
    for DIRECTORY in examples/$KIND/*/; do
        if [ ! -d "$DIRECTORY" ]; then
            continue
        fi
        NAME="$(basename "$DIRECTORY")"
        if [ -n "$ONLY" ]; then
            if [ "$NAME" != "$ONLY" ]; then
                continue
            fi
        fi
        EXAMPLES+=("$KIND/$NAME")
    done
done

CHECKS=()
for FILE in src/smoke/*.smoke.ts; do
    if [ ! -f "$FILE" ]; then
        continue
    fi
    NAME="$(basename "$FILE" .smoke.ts)"
    # A check is printed as check-<name>, so either spelling picks it out.
    if [ -n "$ONLY" ]; then
        if [ "$NAME" != "$ONLY" ]; then
            if [ "check-$NAME" != "$ONLY" ]; then
                continue
            fi
        fi
    fi
    CHECKS+=("$NAME")
done

# One runner's share of the examples. Taking every total-th example rather than a block of them
# spreads the slow ones over the shards. The checks are quick and run on the first shard only.
if [ -n "$SHARD" ]; then
    SHARD_INDEX="${SHARD%%/*}"
    SHARD_TOTAL="${SHARD##*/}"
    case "$SHARD_INDEX/$SHARD_TOTAL" in
        ''|*[!0-9/]*|*/|/*)
            echo "--shard wants <n>/<total>, and \"$SHARD\" is not that." >&2
            exit 1
            ;;
    esac
    if [ "$SHARD_INDEX" -lt 1 ]; then
        echo "--shard $SHARD asks for a shard outside 1 to $SHARD_TOTAL." >&2
        exit 1
    fi
    if [ "$SHARD_INDEX" -gt "$SHARD_TOTAL" ]; then
        echo "--shard $SHARD asks for a shard outside 1 to $SHARD_TOTAL." >&2
        exit 1
    fi

    SHARDED=()
    INDEX=0
    for EXAMPLE in "${EXAMPLES[@]}"; do
        if [ "$((INDEX % SHARD_TOTAL))" -eq "$((SHARD_INDEX - 1))" ]; then
            SHARDED+=("$EXAMPLE")
        fi
        INDEX=$((INDEX + 1))
    done
    EXAMPLES=("${SHARDED[@]+"${SHARDED[@]}"}")
    if [ "$SHARD_INDEX" -ne 1 ]; then
        CHECKS=()
    fi
fi

if [ "$(( ${#EXAMPLES[@]} + ${#CHECKS[@]} ))" -eq 0 ]; then
    if [ -n "$ONLY" ]; then
        echo "There is no smoke test named \"$ONLY\"." >&2
    else
        echo "There are no smoke tests under src/smoke/ or examples/." >&2
    fi
    exit 1
fi

# Everything this script writes goes here, each example's full output included, so a line saying
# it failed can say where to read why. Nothing is ever removed: it is a tmp directory, so what is in
# it is already throwaway, and the last run's logs are worth having until the next one overwrites
# them.
RESULT_DIR="$REPO_DIR/tmp/smoke"
mkdir -p "$RESULT_DIR"

# Takes out the lines and the parts of lines that are different every run, so what is compared is
# what the tool decided rather than how long it took to decide it.
normalise() {
    sed -E \
        -e "s|$REPO_DIR/||g" \
        -e '/^ +Took [0-9hms ]+\.$/d' \
        -e 's/, [0-9]+ calls//' \
        -e 's/seed=[0-9]+/seed=<seed>/g' \
        -e 's|[A-Za-z0-9_./+-]*node_modules/\.cache/faultline/([A-Za-z0-9_.-]+\.txt)|<cache>/\1|g'
}

# Type, size and modification time of every entry in the example directory $1, taken before the run
# and again after it. An example is a repository being fault tested, so the contract's flat promise
# applies to it: the tool writes nothing into it. Faultline keeps its own files under node_modules,
# which is why that directory alone is left out.
manifest_of() {
    (cd "$1" && find . -mindepth 1 -not -path './node_modules' -not -path './node_modules/*' -printf '%y %s %T@ %p\n' | LC_ALL=C sort)
}

# Records that the example whose slug is $1 failed and writes the reason, $2, to its log rather than
# to the terminal.
refuse() {
    {
        echo ""
        echo "FAILED: $2"
    } >> "$RESULT_DIR/$1.log"
    echo "fail" > "$RESULT_DIR/$1.verdict"
}

# Runs flt in the example directory $1 with the rest of the arguments after the first two. $2 goes
# in NODE_OPTIONS, empty for most examples. --no-install so an example whose dependencies are
# missing fails loudly rather than fetching a Faultline other than this one.
run_flt() {
    local directory="$1"
    local node_options="$2"
    shift 2
    ( cd "$directory" && NO_COLOR=1 NODE_OPTIONS="$node_options" npx --no-install flt "$@" )
}

# Runs one example and writes its whole output to its own log. Its verdict, pass or fail, is
# recorded beside the log.
run_one() {
    local example="$1"
    local kind="${example%%/*}"
    local name="${example##*/}"
    local directory="$REPO_DIR/examples/$example"
    local slug="${kind}-${name}"
    local output="$RESULT_DIR/$slug.output"
    local log="$RESULT_DIR/$slug.log"

    # Recorded before the run rather than after it, so an example whose run is interrupted reads as
    # failed rather than keeping whatever the last run said about it.
    echo "fail" > "$RESULT_DIR/$slug.verdict"

    # Each example finds Faultline the way a project that installed it does, through node_modules.
    # The links are made here rather than kept in the repository, because node_modules is left out
    # of git. A link is relative, so it holds wherever the clone is.
    mkdir -p "$directory/node_modules/.bin"
    ln -sfn "../../../.." "$directory/node_modules/faultline"
    ln -sfn "../faultline/dist/bin/flt.js" "$directory/node_modules/.bin/flt"

    # An example that imports a package of its own carries it under packages/ beside it, and it is
    # linked into node_modules for the same reason as Faultline is.
    if [ -d "$directory/packages" ]; then
        local package
        for package in "$directory"/packages/*/; do
            package="$(basename "$package")"
            ln -sfn "../packages/$package" "$directory/node_modules/$package"
        done
    fi

    manifest_of "$directory" > "$RESULT_DIR/$slug.before"

    # An example that has to be run with an option carries it in run-flags.txt beside it, because
    # the option is part of what the example demonstrates.
    local arguments=()
    if [ -f "$directory/run-flags.txt" ]; then
        while IFS= read -r LINE; do
            if [ -n "$LINE" ]; then
                arguments+=("$LINE")
            fi
        done < "$directory/run-flags.txt"
    fi

    # An example that has to run with Node options carries them in node-options.txt beside it, such
    # as the one that loads a file before flt starts to show what flt does under an older Node.
    local node_options=""
    if [ -f "$directory/node-options.txt" ]; then
        node_options="$(cat "$directory/node-options.txt")"
    fi

    # Everything an earlier run kept is thrown away first, so the run executes every file and prints
    # what its expected.txt holds whatever ran before it. The run fills the cache, which the cached
    # run below reads, so one run is both the one compared with expected.txt and the one that fills
    # the cache.
    rm -rf "$directory/node_modules/.cache/faultline"

    # The run uses four workers, so the --jobs 1 run below is the comparison of one worker with
    # four. An example that names its own --jobs, or replays a token, which takes no other option,
    # is run with its own options alone.
    local jobs_option=(--jobs 4)
    if printf '%s\n' "${arguments[@]+"${arguments[@]}"}" | grep -qx -e '--jobs' -e '--replay'; then
        jobs_option=()
    fi

    local code
    run_flt "$directory" "$node_options" "${arguments[@]+"${arguments[@]}"}" "${jobs_option[@]+"${jobs_option[@]}"}" > "$output.raw" 2>&1
    code="$?"
    normalise < "$output.raw" > "$output"

    {
        echo "$kind/$name"
        echo ""
        cat "$output"
        echo ""
        echo "Exit code: $code"
    } > "$log"

    # Checked before what it printed, because a run that left something behind has broken the
    # promise the contract calls absolute whatever else it got right.
    manifest_of "$directory" > "$RESULT_DIR/$slug.after"
    if ! diff -u "$RESULT_DIR/$slug.before" "$RESULT_DIR/$slug.after" > "$RESULT_DIR/$slug.footprint"; then
        {
            echo ""
            echo "What the run changed in the smoke test's own directory:"
            cat "$RESULT_DIR/$slug.footprint"
        } >> "$log"
        refuse "$slug" "it wrote into the repository it was fault testing, and the contract says it writes nothing."
        return
    fi

    if [ "$kind" = "working" ]; then
        if [ "$code" -ne 0 ]; then
            refuse "$slug" "it exited $code, and a working example has to exit 0."
            return
        fi
    fi
    if [ "$kind" = "non-working" ]; then
        if [ "$code" -eq 0 ]; then
            refuse "$slug" "it exited 0, and a non-working example has to exit non-zero."
            return
        fi
    fi

    if [ ! -s "$directory/expected.txt" ]; then
        refuse "$slug" "it has no expected.txt, or it is empty, so there is nothing to compare against."
        return
    fi

    if ! diff -u "$directory/expected.txt" "$output" > "$RESULT_DIR/$slug.diff"; then
        {
            echo ""
            echo "What it printed, against its expected.txt:"
            cat "$RESULT_DIR/$slug.diff"
        } >> "$log"
        refuse "$slug" "it printed something other than its expected.txt."
        return
    fi

    # A run that reported a failure says how to repeat it. Repeating it twice has to fail the same
    # way both times and say what the first run said, which is what makes a replay token worth
    # printing.
    local token
    token="$(grep -m1 '^Reproduce it with: npx flt --replay ' "$output.raw" | sed -E 's/^Reproduce it with: npx flt --replay "(.*)"$/\1/')"
    if [ -n "$token" ]; then
        local sentence
        sentence="$(grep -m1 -B1 '^Reproduce it with:' "$output.raw" | head -1)"
        local replay_code_one replay_code_two
        run_flt "$directory" "$node_options" --replay "$token" > "$output.replay-one.raw" 2>&1
        replay_code_one="$?"
        run_flt "$directory" "$node_options" --replay "$token" > "$output.replay-two.raw" 2>&1
        replay_code_two="$?"
        normalise < "$output.replay-one.raw" > "$output.replay-one"
        normalise < "$output.replay-two.raw" > "$output.replay-two"
        if [ "$replay_code_one" -eq 0 ]; then
            refuse "$slug" "the run printed a replay command and the first replay of it did not fail."
            return
        fi
        if [ "$replay_code_two" -eq 0 ]; then
            refuse "$slug" "the run printed a replay command and the second replay of it did not fail."
            return
        fi
        if ! diff -u "$output.replay-one" "$output.replay-two" > "$RESULT_DIR/$slug.replay-diff"; then
            refuse "$slug" "replaying the same token twice gave two different answers."
            return
        fi
        if ! grep -qF -- "$sentence" "$output.replay-one"; then
            refuse "$slug" "the replay did not repeat the failure the run reported: $sentence"
            return
        fi
    fi

    # The rest compare reports, so they apply only to a run that printed one. A run that refused
    # its options or its token printed a sentence instead.
    if ! grep -q '^  Coverage: ' "$output"; then
        echo "pass" > "$RESULT_DIR/$slug.verdict"
        return
    fi

    # A run that reads its results from the cache has to print the report of the run that filled
    # it, which is the run above. The only line allowed to differ is the one saying how much came
    # from the cache. The kept crashes are thrown away first, because replaying them adds lines of
    # their own. A run narrowed with --file or --function never reads the cache, so it has no cached
    # line.
    rm -f "$directory/node_modules/.cache/faultline/crashes.txt"
    run_flt "$directory" "$node_options" "${arguments[@]+"${arguments[@]}"}" "${jobs_option[@]+"${jobs_option[@]}"}" > "$output.cached.raw" 2>&1
    grep -v '^  Cached ' "$output" > "$output.fill"
    normalise < "$output.cached.raw" | grep -v '^  Cached ' > "$output.cached"
    if ! diff -u "$output.fill" "$output.cached" > "$RESULT_DIR/$slug.cache-diff"; then
        {
            echo ""
            echo "What the cached run printed, against the run that filled the cache:"
            cat "$RESULT_DIR/$slug.cache-diff"
        } >> "$log"
        refuse "$slug" "the run that read the cache printed a report other than the run that filled it."
        return
    fi
    if ! printf '%s\n' "${arguments[@]+"${arguments[@]}"}" | grep -qx -e '--file' -e '--function'; then
        if ! grep -q '^  Cached ' "$output.cached.raw"; then
            refuse "$slug" "the second run printed no line saying it read the cache, so the cache was not used."
            return
        fi

        # The run above kept the crashes it read from the cache. Every one of them is of a file
        # that has not changed, so a run that keeps them has to answer each from the cache and
        # replay none.
        if [ -s "$directory/node_modules/.cache/faultline/crashes.txt" ]; then
            run_flt "$directory" "$node_options" "${arguments[@]+"${arguments[@]}"}" "${jobs_option[@]+"${jobs_option[@]}"}" > "$output.kept.raw" 2>&1
            if grep -q '^  Replayed ' "$output.kept.raw"; then
                refuse "$slug" "a run replayed kept crashes of files that have not changed instead of reading their answers from the cache."
                return
            fi
            if ! grep -q '^  Read [0-9]* kept crash.* from the cache, ' "$output.kept.raw"; then
                refuse "$slug" "a run with kept crashes of files that have not changed printed no line saying it read them from the cache."
                return
            fi
        fi
    fi

    # The first run started from an emptied cache, so it compiled every file and kept what it
    # compiled. A run that printed a report compiled at least one file, so there has to be an entry.
    if [ -z "$(ls -A "$directory/node_modules/.cache/faultline/compiled" 2>/dev/null)" ]; then
        refuse "$slug" "the run kept nothing in the compile cache, so later runs would compile every file again."
        return
    fi

    # The report must not depend on how many workers shared the files, so one worker has to print
    # what the run with four printed. An example that names its own --jobs is that comparison
    # already, and naming it twice is refused. This run reads no kept results but does read the
    # compile cache the first run filled, so it is also the comparison of a run that compiled
    # every file with one that compiled none.
    if [ "${#jobs_option[@]}" -gt 0 ]; then
        rm -f "$directory/node_modules/.cache/faultline/crashes.txt"
        run_flt "$directory" "$node_options" "${arguments[@]+"${arguments[@]}"}" --no-cache --jobs 1 > "$output.jobs-1.raw" 2>&1
        normalise < "$output.jobs-1.raw" > "$output.jobs-1"
        if ! diff -u "$output" "$output.jobs-1" > "$RESULT_DIR/$slug.jobs-1-diff"; then
            {
                echo ""
                echo "What it printed with --jobs 1 from the compile cache, against the run with --jobs 4 that filled it:"
                cat "$RESULT_DIR/$slug.jobs-1-diff"
            } >> "$log"
            refuse "$slug" "with --jobs 1 and the compile cache it printed a report other than the run with --jobs 4 that filled the cache."
            return
        fi
    fi

    # Checked again after the extra runs, because they too must write nothing outside node_modules.
    manifest_of "$directory" > "$RESULT_DIR/$slug.after-all"
    if ! diff -u "$RESULT_DIR/$slug.before" "$RESULT_DIR/$slug.after-all" > "$RESULT_DIR/$slug.footprint"; then
        refuse "$slug" "a run with --jobs or the cache wrote into the repository it was fault testing, and the contract says it writes nothing."
        return
    fi

    echo "pass" > "$RESULT_DIR/$slug.verdict"
}

# What the run took, so a suite that has got slower says so rather than being noticed months later.
STARTED_AT="$(date +%s)"

# One line per example as it finishes, so a long run is not silent. Examples run in parallel, so
# these arrive in the order they finish. The list after the wait is in name order.
FINISHED_FILE="$RESULT_DIR/finished.count"

# Colours only when the output is a terminal, so a log or a pipe holds plain text.
if [ -t 1 ]; then
    GREEN=$'\033[32m'
    RED=$'\033[31m'
    RESET=$'\033[0m'
else
    GREEN=""
    RED=""
    RESET=""
fi
: > "$FINISHED_FILE"

# Seconds as minutes and seconds once there is a minute of them, and as seconds alone before that.
elapsed() {
    local total="$1"
    if [ "$total" -ge 60 ]; then
        printf '%dm %02ds' "$((total / 60))" "$((total % 60))"
    else
        printf '%ds' "$total"
    fi
}

# Milliseconds as seconds to one decimal place, or as minutes and seconds once there are a minute's
# worth, so each smoke test's line says how long it took.
duration_of() {
    local milliseconds="$1"
    if [ "$milliseconds" -ge 60000 ]; then
        elapsed "$((milliseconds / 1000))"
    else
        printf '%d.%ds' "$((milliseconds / 1000))" "$((milliseconds % 1000 / 100))"
    fi
}

# What the clock reads in milliseconds, for timing one smoke test.
now_ms() {
    date +%s%3N
}

# Runs one example and prints one line with its verdict and how long it took as soon as it
# finishes. The time is kept beside its verdict for the list in name order at the end.
run_reported() {
    local example="$1"
    local slug="${example%%/*}-${example##*/}"
    local started
    started="$(now_ms)"
    run_one "$example"
    duration_of "$(( $(now_ms) - started ))" > "$RESULT_DIR/$slug.duration"
    print_finished "$slug" "${example##*/}"
}

# Writes the line for the smoke test whose slug is $1 and whose name is $2: its place in the order
# the tests finished, its verdict, its name and how long it took. Checks and examples share the one
# count and the one layout. The count and the line are written under a lock, so two examples that
# finish together neither share a number nor mix their lines.
print_finished() {
    local slug="$1"
    local name="$2"
    (
        flock 9
        echo "$slug" >> "$FINISHED_FILE"
        printf '  [%*s/%s] %s\n' "${#TOTAL}" "$(wc -l < "$FINISHED_FILE" | tr -d ' ')" "$TOTAL" "$(result_line "$slug" "$name")"
    ) 9>> "$FINISHED_FILE.lock"
}

# The verdict, the name padded to the longest name and the time taken of the smoke test whose slug
# is $1 and whose name is $2, so every line puts each in the same column.
result_line() {
    local slug="$1"
    local name="$2"
    local verdict="${RED}FAIL${RESET}"
    if [ "$(cat "$RESULT_DIR/$slug.verdict" 2>/dev/null)" = "pass" ]; then
        verdict="${GREEN}pass${RESET}"
    fi
    printf '%s  %-*s  %s' "$verdict" "$NAME_WIDTH" "$name" "$(cat "$RESULT_DIR/$slug.duration" 2>/dev/null)"
}

# Runs one check, writes what it printed to its own log and records pass or fail beside it.
run_check() {
    local name="$1"
    local slug="check-$name"
    local log="$RESULT_DIR/$slug.log"
    echo "fail" > "$RESULT_DIR/$slug.verdict"
    local code
    local started
    started="$(now_ms)"
    node "src/smoke/$name.smoke.ts" > "$RESULT_DIR/$slug.output" 2>&1
    code="$?"
    duration_of "$(( $(now_ms) - started ))" > "$RESULT_DIR/$slug.duration"
    {
        echo "check/$name"
        echo ""
        cat "$RESULT_DIR/$slug.output"
        echo ""
        echo "Exit code: $code"
    } > "$log"
    if [ "$code" -eq 0 ]; then
        echo "pass" > "$RESULT_DIR/$slug.verdict"
    fi
}

# How many smoke tests the run holds and how wide the longest name is, so every line lines up.
TOTAL=$(( ${#CHECKS[@]} + ${#EXAMPLES[@]} ))
NAME_WIDTH=0
for CHECK in "${CHECKS[@]+"${CHECKS[@]}"}"; do
    NAME="check-$CHECK"
    if [ "${#NAME}" -gt "$NAME_WIDTH" ]; then
        NAME_WIDTH="${#NAME}"
    fi
done
for EXAMPLE in "${EXAMPLES[@]+"${EXAMPLES[@]}"}"; do
    NAME="${EXAMPLE##*/}"
    if [ "${#NAME}" -gt "$NAME_WIDTH" ]; then
        NAME_WIDTH="${#NAME}"
    fi
done

echo "Running ${#CHECKS[@]} check(s) one after another, then ${#EXAMPLES[@]} example(s), $PARALLEL at a time."
echo ""

for CHECK in "${CHECKS[@]+"${CHECKS[@]}"}"; do
    run_check "$CHECK"
    print_finished "check-$CHECK" "check-$CHECK"
done

RUNNING=0
for EXAMPLE in "${EXAMPLES[@]}"; do
    run_reported "$EXAMPLE" &
    RUNNING=$((RUNNING + 1))
    if [ "$RUNNING" -ge "$PARALLEL" ]; then
        wait -n
        RUNNING=$((RUNNING - 1))
    fi
done
wait

# One line per smoke test, checks first and then examples in name order, whatever order they
# finished in, so two runs of the same tree read the same way. The layout is that of the lines above
# without the count, which here would say nothing.
echo ""
echo "In name order:"
PASSED=0
FAILED=()
for CHECK in "${CHECKS[@]+"${CHECKS[@]}"}"; do
    printf '  %*s %s\n' "$(( ${#TOTAL} * 2 + 3 ))" "" "$(result_line "check-$CHECK" "check-$CHECK")"
    if [ "$(cat "$RESULT_DIR/check-$CHECK.verdict" 2>/dev/null)" = "pass" ]; then
        PASSED=$((PASSED + 1))
    else
        FAILED+=("check/$CHECK")
    fi
done
for EXAMPLE in "${EXAMPLES[@]+"${EXAMPLES[@]}"}"; do
    KIND="${EXAMPLE%%/*}"
    NAME="${EXAMPLE##*/}"
    SLUG="${KIND}-${NAME}"
    printf '  %*s %s\n' "$(( ${#TOTAL} * 2 + 3 ))" "" "$(result_line "$SLUG" "$NAME")"
    if [ "$(cat "$RESULT_DIR/$SLUG.verdict" 2>/dev/null)" = "pass" ]; then
        PASSED=$((PASSED + 1))
    else
        FAILED+=("$EXAMPLE")
    fi
done

TOOK="$(elapsed $(( $(date +%s) - STARTED_AT )))"

echo ""
echo "Ran $(( ${#CHECKS[@]} + ${#EXAMPLES[@]} )) smoke test(s), $PASSED passed, in $TOOK."

if [ "${#FAILED[@]}" -gt 0 ]; then
    echo "" >&2
    echo "These did not pass. The whole of what each one printed is in its log:" >&2
    for EXAMPLE in "${FAILED[@]}"; do
        KIND="${EXAMPLE%%/*}"
        NAME="${EXAMPLE##*/}"
        SHOWN="$NAME"
        if [ "$KIND" = "check" ]; then
            SHOWN="check-$NAME"
        fi
        printf '  %-*s  tmp/smoke/%s-%s.log\n' "$NAME_WIDTH" "$SHOWN" "$KIND" "$NAME" >&2
    done
    exit 1
fi

# A complete run marks the target up to date. A run of one example or one shard covered part of the
# target, so it does not.
if [ -z "$ONLY" ]; then
    if [ -z "$SHARD" ]; then
        if command -v what-changed >/dev/null 2>&1; then
            # Its output is collected and echoed rather than left to go straight out, because it
            # seeks to the start of whatever it was handed and writes there. Sent to a terminal that
            # is harmless; sent to a file, it overwrites the first lines of this run's own report. A
            # command substitution hands it a pipe, which has no start to seek to.
            CAPTURED="$(what-changed baseline capture smoke 2>&1)"
            echo "$CAPTURED"
        else
            echo "what-changed is not installed, so the smoke baseline was not captured."
        fi
    fi
fi
