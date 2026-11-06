# Train-only steps of scripts/ci, run as lanes. Source this (and ci-scope.sh), then:
#   train_only_steps <train 0|1>      the scope's train-* step functions in two lanes; 0 runs only
#                                      the browser suites (scripts/ci --e2e)
#   parallel_lanes <log dir> <lane>…   a lane is a string of shell function names, run in order;
#                                      lanes run side by side, each step's output in <log dir>/<name>.log
# A failed step stops its lane; the other lanes finish. Every failed step is reported by name with its log.
# Returns 1 when any step failed, any lane died, or a step left no exit status: the gate fails closed.

run_lane() {
  local dir=$1 name code began pid
  shift
  for name in "$@"; do
    echo "start $name"
    began=$SECONDS
    # Background subshell, not `||`: bash ignores `set -e` inside any command that is part of a `||` list.
    (
      set -e
      "$name"
    ) >"$dir/$name.log" 2>&1 &
    pid=$!
    wait "$pid" && code=0 || code=$?
    echo "$code" >"$dir/$name.exit"
    echo "done  $name: exit $code, $((SECONDS - began))s"
    ((code == 0)) || return 1
  done
}

parallel_lanes() {
  local dir=$1 lane name failed=0 code pid
  local -a pids=()
  shift
  mkdir -p "$dir"
  rm -f "$dir"/*.exit
  for lane in "$@"; do
    run_lane "$dir" $lane &
    pids+=("$!")
  done
  for pid in "${pids[@]}"; do
    wait "$pid" || failed=1
  done
  for lane in "$@"; do
    for name in $lane; do
      if [[ -e $dir/$name.exit ]]; then
        code=$(<"$dir/$name.exit")
        ((code)) || continue
      else
        # The lane's step that never recorded a status: the lane died or could not write it.
        code="none"
      fi
      failed=1
      printf '\nFAILED %s (exit %s), log %s\n' "$name" "$code" "$dir/$name.log"
      cat "$dir/$name.log" 2>/dev/null || true
      break
    done
  done
  return "$failed"
}

# Budgets rebuild the SPA and the release binaries; the other lane starts with the cheap coverage steps,
# so the browser suite begins after the SPA build and the two never share a dev server or a build directory.
train_only_steps() {
  local train=$1 lane_budgets="" lane_main="" logs code errexit=$-
  if ((train)); then
    lane_main="train-coverage"
    selected rust && lane_main+=" train-rust-coverage" || echo "skip rust coverage: ${scope_reason[rust]}"
    selected budgets && lane_budgets="train-budgets" || echo "skip budgets: ${scope_reason[budgets]}"
  fi
  selected e2e && lane_main+=" train-e2e" || echo "skip e2e: ${scope_reason[e2e]}"
  if selected e2e || selected rust; then
    lane_main+=" train-e2e-core"
  else
    echo "skip e2e core: ${scope_reason[rust]}"
  fi
  logs=$(mktemp -d "${TMPDIR:-/tmp}/sunreye-ci-XXXXXX")
  # A plain call: under `||`, `&&`, `if` or `!` bash ignores `set -e` in every step the lanes run.
  set +e
  parallel_lanes "$logs" "$lane_budgets" "$lane_main"
  code=$?
  [[ $errexit == *e* ]] && set -e
  rm -rf "$logs"
  return "$code"
}
