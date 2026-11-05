# Mutation-testing spike (#461)

Question: would `cargo-mutants` (27.1.0) on a PR's diff earn a place in `scripts/ci`? Measured on #450, #451, #452 with `cargo mutants --in-diff <rust diff> --jobs 2 --timeout 180..400 --build-timeout 300`, in a scratch worktree with its own `TMPDIR` and target (removed afterwards). The host was shared: load average was 12-27 for most of the run, so wall times are upper bounds.

| PR | Diff | Generated | Tested | Caught | Missed | Unviable | Wall | Peak disk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| #450 | merge `366d96c0` vs first parent | 32 | 32 | 15 | 3 | 14 | 15m | 6.8 GB |
| #451 | `origin/factory/437` (`f9ceef74`) vs `origin/v4` | 102 | 15 (partial) | 11 | 0 | 3 (+1 timeout) | 40m cap | 8.4 GB |
| #452 | merge `fcd0f625` vs first parent | 227 | 88 (partial, shuffled) | 71 | 9 | 8 | 40m cap | 6.7 GB |
| #452 pre-fix | `a91ac318`, 3 files, regex-scoped | 48 | 48 | 45 | 1 | 2 | 26m | 7.6 GB |

- Cost per mutant: about 20s build plus 55s test, with every `sunreye` test binary rebuilt and rerun. Unmutated baseline: 35s build plus 47s test. Disk is the scratch total, warm target copy included.
- #451 baseline failed twice under load: `a_new_devices_first_minute_on_a_full_store_reads_only_its_own_buckets` (a 100 ms budget) and the 270s idle-timeout test in `web/tests/ws.rs`. The third run skipped the first. #451's branch moved from `b5f39d1e` (reviewed) to `f9ceef74` during the spike.

## Missed mutants against the reviews

| Missed | Reviewers |
| --- | --- |
| #450 `reachability.rs:75` `>` to `>=`: no test sends the 16-candidate maximum | not raised |
| #450 `probe.rs:166` `elapsed_ms` returns 0 or 1: the reported ms is never asserted | not raised |
| #452 `solar.rs:18` TTL constant, `median_load` window and TTL arithmetic (8 mutants) | not raised |
| #452 `open_meteo.rs:132` `i == 0` flips which plane carries the first-request parameters | not raised |
| #452 pre-fix `web/devices.rs:205` `pv_field` `\|\|` to `&&` | partly: nulls on a meter PATCH, noted as J-d |

Reviewer blockers that `cargo-mutants` did not reproduce, because it rewrites function bodies and operators only:

- #452 geometry bounds (tilt 90, azimuth +-180, kwp): literals are never mutated. On the pre-fix tree the operator mutants in `above` and `within` were already caught.
- #452 B1-B3 (temperature length, empty body, `Option<Option>` null): the pre-fix run over `assemble`, `decode`, `apply_pv` and `validate` surfaced none of them.
- #451 B1-B3 (roster filter, `is_finite` skip, `folded.truncate`): deleted statements and closures are not mutants. Only whole-function stubs exist for `spawn_devices` and `buckets`.
- #450 blockers are TypeScript (kinds helper, i18n key, journey cleanup): out of scope.

Mutation testing found test gaps the reviewers missed, all minor. It found none of the blocking findings. Reviewers' by-hand mutants (literal and deleted-line) cover the complement.

## Decision: no gate

- A diff-scoped run costs 15m for 32 mutants. #451 and #452 would need an estimated 77m and 170m unloaded; no budget that fits `scripts/ci` covers them, and a sampled run proves nothing about the unsampled lines.
- A 40m cap tests 15-90 mutants and finds minor gaps only, at the price of a baseline that must be load-proof (two flaky or slow tests in `sunreye` already broke it).
- Not rejected as advice: the missed boundaries above are test gaps worth one ticket. A reviewer may run `cargo mutants --in-diff <diff> --jobs 2 -F <regex>` on a function a PR changed. It is not part of the gate.
