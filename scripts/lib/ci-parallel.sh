# Train-only steps of scripts/ci, run as lanes. Source this, then:
#   parallel_lanes <log dir> <lane>…   a lane is a string of shell function names, run in order;
#                                      lanes run side by side, each step's output in <log dir>/<name>.log
# A failed step stops its lane; the other lanes finish. Every failed step is reported by name with its log.
# Returns 1 when any step failed.

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
    ((code == 0)) || return 0
  done
}

parallel_lanes() {
  local dir=$1 lane name failed=0 code
  shift
  mkdir -p "$dir"
  rm -f "$dir"/*.exit
  for lane in "$@"; do
    run_lane "$dir" $lane &
  done
  wait
  for lane in "$@"; do
    for name in $lane; do
      [[ -e $dir/$name.exit ]] || continue
      code=$(<"$dir/$name.exit")
      ((code)) || continue
      failed=1
      printf '\nFAILED %s (exit %s), log %s\n' "$name" "$code" "$dir/$name.log"
      cat "$dir/$name.log"
    done
  done
  return "$failed"
}
