# Step selection for scripts/ci; the table is scripts/ci-scope.ts. Source this, then:
#   scope_load [ci-scope args]   compute the scope; fails when it cannot, which stops the gate
#   selected <step>              true when the step runs; a step the scope never named runs
#   scoped <step> <label>        open the step with `step`, or print the skip line and return 1
declare -gA scope_verdict=() scope_reason=()

scope_load() {
  local out name verdict reason
  out=$(bun scripts/ci-scope.ts "$@") || return 1
  while read -r name verdict reason; do
    scope_verdict[$name]=$verdict
    scope_reason[$name]=$reason
  done <<<"$out"
}

selected() { [[ ${scope_verdict[$1]:-run} == run ]]; }

scoped() {
  if selected "$1"; then
    step "$2"
  else
    echo "skip $2: ${scope_reason[$1]}"
    return 1
  fi
}
