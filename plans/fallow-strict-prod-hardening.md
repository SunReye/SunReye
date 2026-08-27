# Fallow strict mode — prod hardening burn-down

Status: **complete.** Phases 0-4 were burned down by six parallel agents in separate worktrees and
the repo reached `bunx fallow` exit 0 at `d38865c`; Phase 5 was spiked and rejected. `98b034f` landed
the Phase 6 ratchets (`includeEntryExports`, health `10/10`, boundary coverage + forbidden calls),
which deliberately re-redded the repo with 27 unused exports/types + 9 complexity findings; those
were cleared in code — not by weakening the config — and fallow is now wired into CI. Green under the
strict config at `3ab4c86`: 0 dead-code, 0 clone groups, 0 above threshold, maintainability 92.4.
Two standing follow-ups remain, both deliberately deferred (see Phase 6).
Config: [.fallowrc.json](../.fallowrc.json) · verify with `bunx fallow`, gate with `bunx fallow audit`.

## What the config change did

| Area                | Before                                                                   | After                                                              |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `health`            | 3 `thresholdOverrides` (web 25/30/700, inverter-core 15/20/200, server crap 120) | no overrides; global `12 / 12 / 30`                          |
| `rules`             | 2 rules downgraded to `warn`                                             | 20 rules forced to `error`, incl. off-by-default ones              |
| `duplicates`        | defaults (minTokens 50)                                                  | `minTokens 40`, `minLines 5`                                       |
| `production`        | —                                                                        | `deadCode: true` (test-only usage no longer keeps prod code alive) |
| `boundaries`        | —                                                                        | 8 zones + import rules; web→server allowed type-only only          |
| `audit.gate`        | `new-only` (CLI flag in lint-staged)                                     | `all` — any finding in a touched file blocks the commit            |

Newly enforced rules that were `warn`/`off`: `private-type-leaks`, `require-suppression-reason`,
`stale-suppressions`, `unused-dev-dependencies`, `unused-optional-dependencies`,
`type-only-dependencies`, `test-only-dependencies`, `re-export-cycle`, `unused-store-members`,
`unused-svelte-events`, `unused-load-data-keys`, catalog/override rules, client/server directive
rules, `security-sink`, `security-client-server-leak`, `policy-violation`.

## The CRAP caveat (read before refactoring)

No coverage data is wired, so fallow estimates coverage. At zero coverage CRAP collapses to
`cyclomatic² + cyclomatic`, and fallow fires on `>=`. At cyclomatic 5 that is exactly 30, so
`maxCrap 30` behaves as a **hard ceiling of cyclomatic 4** — anything at 5 or above fails
(confirmed empirically: the lowest cyclomatic among the findings is 5, and no cyclomatic-4 function
is flagged),
stricter than the declared `maxCyclomatic 12`:

- 118 health findings total
- 77 are CRAP-only (cyclomatic ≤ 12 **and** cognitive ≤ 12) — i.e. they fail purely on the
  estimated-coverage ceiling
- 24 exceed cyclomatic 12, 39 exceed cognitive 12

Phase 5 wires real coverage; once it lands, most of the 77 CRAP-only findings resolve without a
refactor (any covered function scores far lower), and `maxCrap 30` starts meaning what it says.
**Do Phase 5 before mass-refactoring the CRAP-only tail** unless the goal is genuinely
cyclomatic-≤5 code everywhere.

## Fallout inventory (measured, 2026-07-26)

```
dead code   38   16 unused exports (production mode) · 18 private-type-leaks · 4 suppressions missing a reason
health     118   78 files — 49 Svelte <template> · 39 web script fns · 25 server · 5 inverter-core
dupes       23   clone groups, 1.34% duplicated lines, 25 files
boundaries   0   (4 web→server imports are all `import type`, covered by allowTypeOnly)
```

Regenerate any list with:

```bash
bunx fallow health --format json | jq '.findings'
bunx fallow dead-code --format json
bunx fallow dupes --format json
```

## Working under `audit.gate: "all"`

Done: the lint-staged entry is now `bunx fallow audit --quiet` with no `--gate` flag, so the config's
`gate: "all"` is in force (a CLI `--gate` would override the config).

With `gate: all` active, a commit touching any of the 78 health-finding files fails until that file
is clean. Consequences to plan around:

- Land remediation file-by-file, cleaning each file you need to touch anyway.
- Urgent unrelated fix in a dirty file → clean it in the same commit, or `git commit --no-verify`
  with a follow-up issue. Do not silence with blanket ignores.
- CI must run `bunx fallow` (currently red) — wire it only at the end of Phase 4, or wire it now
  with `--report-only` and flip after Phase 4.

## Suppression policy

`require-suppression-reason` is on, so every inline suppression needs a `--` reason:

```ts
// fallow-ignore-next-line complexity -- exhaustive register decode table; splitting hurts readability
```

Budget: suppressions are for genuinely irreducible code (exhaustive switch/decode tables, generated
manifests). Cap at ~10 repo-wide; anything more means the threshold is wrong, not the code.

## Phase 0 — zero-refactor cleanups (38 dead-code findings)

1. **4 suppressions missing a reason** — append `-- <reason>` to each:
   - `apps/docs/astro.config.mjs:34` (complexity)
   - `apps/server/src/inverter/inverter.ts:194` (unused-type)
   - `apps/web/scripts/relativize-fallback.ts:18` (unresolved-import)
   - `packages/inverter-core/src/sdk.type-test.ts:1` (unused-file, file-level)
2. **18 private-type-leaks** — export the referenced type next to its public signature:
   `apps/server/src/automation/automation.ts` (`EvInputs` ×2), `evcc.ts` (`EvccListener`),
   `history.ts` (`HistoryQuery` ×2), `logging.ts` (`LogListener`),
   `mqtt.ts` (`Topics`, `HaDevice`, `Discovery`), `runtime.ts` (`SampleListener`),
   `apps/web/src/lib/inverter/ranges.ts` (`Preset`),
   `apps/web/src/lib/ws/reconnecting-socket.ts` (`SocketLike`),
   `packages/inverter-core/src/define.ts` (`RoledMetricOpts`, `UnroledMetricOpts`, `ControlOpts`),
   `packages/inverter-core/src/driver.ts` (`ReadBlock` ×2),
   `packages/profile-sdk/src/init.ts` (`GuideFile`).
3. **16 production-mode unused exports** — exports only consumed by tests. Per symbol: either
   un-export and test through the public entry point, or keep exported and accept it is public API
   (then it needs a real caller). Candidates:
   `automation.ts` (`resolvePeakShavingBlockers`, `evccAutomationInputs`, `surplusAboveKwh`,
   `decideTargetA`, `createPeakShavingEngine`), `cost.ts` (`resolveLiveTodayTotals`),
   `evcc.ts` (`parseLoadpointTopic`, `coercePayload`), `mqtt.ts` (`forecastDiscoveryConfig`),
   `solar-forecast.ts` (`pvPowerW`), `power-graph.ts` (`sense`, `flowColor`, `gridColor`),
   `inverter-core/driver.ts` (`splitBlock`), `inverter-core/profile-data.ts` (`computeExprInputs`),
   `profile-sdk/init.ts` (`toIdentifier`).

Verify: `bunx fallow dead-code` → 0 issues.

## Phase 1 — server complexity (25 findings, 12 files)

Highest first; all are real decomposition targets, not artifacts:

| Function                                              | cyc/cog | Approach                                                              |
| ----------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| `automation.ts:487 steer`                             | 18/15   | split per-decision branch into named guard helpers                    |
| `forecast-correction-job.ts:230 runForecastCorrectionLearn` | 18/12 | extract observation filtering + fit steps                        |
| `solar-forecast.ts:340 buildSolarForecast` (143 LOC)  | 14/7    | split slot assembly / clipping / capping stages                       |
| `automation.ts:554 runTick`                           | 13/13   | extract sampling + dispatch                                           |
| `solar-forecast.ts` `resolveSimInputs`, `usableSeries`, `resolveDayStartSoc` | 10-12 | pull provider-shape normalisation into small pure fns  |
| `ev-power-estimator.ts feedForward`, `evcc.ts trackEstimator` | 11 | extract clamp/branch tables                                     |
| `mqtt.ts discoveryConfig` (65 LOC), `mqtt.ts:281`     | 8-10    | table-drive the discovery payloads                                    |
| `weather.ts toReading`/`fetchWeather`, `energy.ts accumulateTotals`, `entities.ts checkApiKey`, route arrows in `index.ts`/`settings.ts`/`custom-charts.ts` | 5-9 | CRAP-only tail — leave for Phase 5 |

Verify: `bunx fallow health --format json | jq '[.findings[]|select(.path|startswith("apps/server"))]|length'`

## Phase 2 — inverter-core (5 findings)

`define.ts:321 pruneComputeExpr` (15/20), `codec.ts:23 decode` (14/13),
`generic-sim.ts:98 genericSimulate` (13/15, 112 LOC), `schema.ts:137` (10/13),
`driver.ts:94 resolveAtomicGroups` (9/13). These are the library core, shipped in the profile SDK —
decompose properly and add unit tests (which also feeds Phase 5 coverage).

## Phase 3 — web (88 findings: 49 templates + 39 script fns)

Script functions first — they are ordinary refactors:
`power-graph.ts:295 buildPowerGraph` (25/20, 159 LOC) is the worst in the repo;
`solar-forecast-dialog.svelte:87 loadActual` (16/26), `weather-form.svelte:96 parseForecast` (14/15),
`chart-axes.ts:71 domainFor` (11/19).

Then `<template>` findings (49). A synthetic `<template>` function accumulates every `{#if}`,
`{#each}`, `{:else if}` and inline ternary in markup, so under the CRAP ceiling a component with
~6 branches fails. Order of preference:

1. Move conditional *value* computation into named `$derived`/helper functions in `<script>`. This
   genuinely works: branch count leaves the `<template>` rather than being re-attributed (verified).
2. Split genuinely multi-state components into **real subcomponents**. `{#snippet}`s do **not** help
   — fallow folds snippet bodies and inline arrow bodies into the parent's synthetic `<template>`
   function. Measured on `tou-timeline.svelte`: hoisting markup into a top-level snippet left
   cyclomatic at 20 and pushed cognitive 27 → 29. Only a separate component file moves the branches.
   `{#key}` blocks count as a branch too.
3. Only where neither applies (manifest-driven metric rendering), suppress with a reason. In practice
   this was never needed: all 118 findings were resolved by decomposition with **zero** suppressions.

Worst offenders: `tou-timeline.svelte` (5 findings), `weather-form.svelte` (4),
`solar-forecast-dialog.svelte`, `control-row.svelte`, `(app)/+layout.svelte`,
`available-profiles-browser.svelte`, `store.svelte.ts` (3 each), then
`daily-energy.svelte`, `system/+page.svelte`, `tou-table.svelte`, `power-flow-diagram.svelte`,
`logs-viewer.svelte`, `inverter-form.svelte`, `api-keys-form.svelte`, `mqtt-form.svelte`,
`AuthForm.svelte`, `tariff-form.svelte`, `custom-chart-editor.svelte`, `grouped-profile-list.svelte` (2 each).

## Phase 4 — duplication (23 clone groups)

Three real clusters plus schema boilerplate:

- **Server route validation** — `routes/settings.ts` self-clones (82-96 / 117-130, 102-111 / 123-142)
  and shares blocks with `routes/automations.ts:29-38`. Extract a shared settings-patch validator.
- **Cost totals shape** — `apps/server/src/energy/cost-calc.ts:34-54` duplicated in
  `apps/web/src/routes/(app)/costs/+page.svelte:16-26`. Move the type into a shared package and
  import it type-only (boundary rules already allow web→server type-only).
- **Solar providers** — `solar-providers/open-meteo.ts:39-45` vs `open-meteo-archive.ts:40-47`:
  extract shared response mapping.
- **Web chart/form pairs** — `cost-bar-chart`/`hourly-bar-chart`, `custom-chart-card`/`custom-live-chart`,
  `custom-live-chart`/`live-area`, `entity-history-card`/`live-area`,
  `api-keys-form`/`users-form` (3 groups — same table+dialog pattern),
  `installed-profiles-list`/`setup/profile-step`, `available-profile-group` self-clone,
  `custom-chart-editor`/`history/+page`.
- **Drizzle schema boilerplate** — `packages/db/src/schema/auth.ts` self-clones ×2,
  `custom-charts.ts`/`settings.ts`, `forecast-correction.ts`/`settings.ts`. Extract shared column
  helpers (`timestamps`, id columns) rather than ignoring them.
- `packages/inverter-core/src/profile-data.ts:106-117` vs `types.ts:69-95` — one is a duplicated
  type shape; converge on one declaration.

Verify: `bunx fallow dupes` → 0 groups.

## Phase 5 — wire real coverage: SPIKED AND REJECTED (2026-07-26)

`health.coverage` needs Istanbul `coverage-final.json`. `bun test --coverage` emits **lcov only**,
fallow rejects `coverage/lcov.info` (`failed to parse coverage data`), and bun's lcov carries no
`FN:`/`FNDA:` records — so there is no function-level data to convert.

An lcov→Istanbul converter was written, measured, and **deleted**. Result: statement-only Istanbul
data does not produce honest per-function CRAP. Loading any parseable Istanbul file relaxes every
function that fallow's *static* estimator had already tiered `partial`/`high` to effectively 100%
coverage (`crap == cyclomatic`), whether the hit counts are real or all zeroed — 2234 of 2236
functions scored byte-identical between real and zeroed input. `coverage_source` still reports
`estimated`, so nothing in the output admits the data was ignored. The converter would have made
fallow silently report coverage that does not exist.

Fallow *does* compute real per-function coverage, but only for functions it can anchor in `fnMap`
(then `coverage_source` flips to `istanbul` and CRAP tracks the statement hits — verified on
`inverter-core/src/driver.ts:94 resolveAtomicGroups`: 9 when covered, 90 when zeroed). The blocker
is bun's reporter having no `FN:` records. Ways forward, all out of scope for now:

- an Istanbul-native coverage reporter for bun,
- fallow ingesting lcov `DA:` ranges directly (upstream ask),
- a two-pass bootstrap synthesising `fnMap` from fallow's own `health --format json` function list.

**Consequence:** `maxCrap 30` stays a de-facto cyclomatic-4 policy, and the CRAP-only tail is
real work rather than something coverage will dissolve. If that trade stops being worth it, the
one-line alternative is `maxCrap: 170` — at zero coverage CRAP is `cyc² + cyc` and fires on `>=`, so
170 fires only at cyclomatic ≥ 13, i.e. never before `maxCyclomatic: 12` does. That drops the
burn-down to **41 findings** (29 web / 7 server / 5 inverter-core, zero CRAP-only) and keeps CRAP
useful for later. `156` would be off by one — it fires at cyclomatic 12, which `maxCyclomatic: 12`
itself permits.

Not reproduced: the claim that a stale `coverage/` directory shifts the count via lcov
auto-discovery. Measured in the real checkout with `--no-cache`, with and without `coverage/`:
118 findings both ways. The relaxation above needs a parseable *Istanbul* file, which nothing
generates now.

Coverage is thin regardless: 69 files in lcov, 78 of 247 runtime files covered (31.6%);
`automation.ts`, `runtime.ts`, `history.ts`, `profiles.ts`, `weather.ts`, `energy.ts` and
`entities.ts` have none. Real tests written alongside the Phase 1-3 refactors are what would
actually lower CRAP.

## Outcome (2026-07-26)

Burned down in parallel: six agents, one git worktree each, split by directory (`apps/server`,
`packages/**`, web settings+setup, web `lib/components/inverter`, web routes+client-libs, tooling),
merged back into `feat/1.3.0` without a single conflict. ~50 commits.

- **118 → 0** health findings, **38 → 0** dead-code, **23 → 0** clone groups, 0 boundary violations.
- **Zero suppressions used** across the whole burn-down (budget was 2 per agent) and zero refactors
  declined. Maintainability 91.9 → 92.4 over ~4600 more analysed lines.
- Tests: 393 pass / 9 fail, the 9 being the pre-existing `git-source` env-TDZ + `initProfiles` set.
  `svelte-check` 4049 files 0 errors, `check-types` clean, `oxlint` clean.
- The real pre-commit gate (`fallow audit` with `gate: "all"`) now passes on a normal commit.

Two cross-scope findings emerged only after merging, neither attributable to one agent:

- `private-type-leaks` is **transitive** — exporting a leaked type can surface fresh leaks in the
  types it references (hit in `inverter-core`).
- `duplicate-exports` fires across *apps* once a type-only import links them into one graph: web's
  rich `CostRange` object collided with the server's pre-existing `CostRange` string union, which
  had sat unnoticed because nothing bridged the two graphs. Renamed to `CostRangeKey`.

Convention left inconsistent on purpose, worth settling: test-only exports were resolved two ways —
`@internal` JSDoc (which fallow honours) in `packages/**`, and genuine un-exporting plus rewritten
tests in `apps/web`. Pick one.

## Phase 6 — ratchets (landed) and standing follow-ups

The first four items below **landed** (config in `98b034f`, the findings they exposed cleared in code,
CI gate wired). The last two are intentionally open. Findings counts are what each ratchet exposed at
the time it was flipped, kept as the record of what it cost.

- `includeEntryExports: true` → **+113 findings** (55 unused exports, 36 unused types, mostly
  `packages/profile-sdk` 48, `packages/db` 23, `packages/inverter-core` 15). This is unused public
  API surface on internal packages; worth doing, sizeable.
- `boundaries.coverage` policy so new files must belong to a zone; `boundaries.calls` to ban
  direct DB access outside `packages/db`.
- Tighten `health` to `10 / 10` (+22 findings at today's code) once coverage is real.
- Wire fallow into CI — **landed.** Fallow used to run only pre-commit via lint-staged; it is now
  also a `Code health gate` step (`bunx fallow --quiet`) in the `quality` job of
  `.github/workflows/ci.yml`, so it runs on every `push` to `master` and every `pull_request`. The
  step sits **directly after** `Install dependencies` and inherits the job's
  `SKIP_ENV_VALIDATION: "1"` — running fallow before install invents findings (31 vs 27: two
  unused-dependency plus one unresolved-import). Never move it into the `test` job, which runs
  `test:coverage` → the Phase 5 CRAP-relaxation hazard.
  - It runs the **full-repo `bunx fallow`**, not `fallow audit`: the full run is history-independent,
    so `actions/checkout`'s default `fetch-depth: 1` is fine (a shallow clone only degrades hotspot
    analysis, verified) and no stale base ref can weaken it. `fallow audit` would need
    `fetch-depth: 0` or a pinned `FALLOW_AUDIT_BASE`. Cost is ~1s of analysis.
  - No `--gate` flag: a CLI `--gate` overrides the config, and `audit.gate: "all"` is config-owned.
    `--quiet` only drops progress/spinner output, meaningless in a non-TTY log; the full ~440-line
    report is kept so a failure is debuggable from the log alone. `--format compact` was measured and
    rejected — it is a machine format that emits a `file-score` line per file (55KB here), and
    `--summary` gives counts with no file/line.
  - No SARIF upload: `ci.yml` declares `permissions: contents: read`, SARIF needs
    `security-events: write`, and that token is not granted on fork PRs, so the step would fail
    there. Note `--ci` is an alias for `--format sarif --fail-on-issues --quiet`, not just "CI mode".
  - The `concurrency` group cancels superseded runs but cannot skip a step, and `push`/`pull_request`
    carry no path filters, so a fallow failure cannot be silently skipped.
  - If a gate is ever wanted *before* a burn-down is finished, the honest mechanism is
    `--fail-on-regression` against a committed `--regression-baseline` (ratchets down, hides
    nothing), not `--report-only` or `continue-on-error`.
- Shrink `ignorePatterns`: `apps/web/src/lib/components/ui/**` + `hooks/**` + `utils.ts` are vendored
  shadcn-svelte and currently hide 260 findings — keep ignored while they stay vendored, revisit if
  they get hand-edited.
- Drop the last `ignoreDependencies` entries as each becomes statically detectable.
