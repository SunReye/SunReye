# 1. AutomationIO stays wide

Status: accepted (2026-09-27)

## Context

`AutomationIO` (`apps/server/src/automation/peak-shaving-engine.ts`) has ~20 members; `AutomationModules`
(`automation.ts`) restates them. Proposed: one `snapshot()` read per tick, a `PlantPort`, a `StateStore`,
a `Clock`, and a pure `tick(snapshot, state) → { writes, nextState, status }` behind a thin executor,
to shrink the interface and the ~3,000-line `peak-shaving.test.ts`. Sketched and measured first:

- **The interface only regroups.** Ten `Inputs` fields + port (write, constraint, evccCommand, device)
  + store (load, save) + clock + recorder ≈ 17 names, against 20 today.
- **The seam is not why the tests are long.** One `harness()` (~105 lines) builds every member once;
  each of the 186 cases takes it in one line and overrides via `h.set.x(...)`. Three typical cases
  ("activation snapshots then steers" 8 lines, "stale sample halts all writes" 7, "re-asserts after an
  external edit" 9) come out equal or longer: multi-tick cases must thread `nextState` and the register
  readback by hand. Best case the harness loses ~30 lines, ~1% of the file.
- **A tick's effects depend on each other's outcomes.** `ensureSnapshot` persists the user's value
  *before* the first steering write, so a crash cannot lose it; `restoreSnapshot` keeps a snapshot only
  for the register whose write failed (`WriteRejectedError` → `lastError`, `restorePending`); EVCC claims
  go mode → limit → boost and release in reverse, a throw meaning "not claimed, keep no snapshot"; and
  `loadState` mid-tick reads state saved earlier that tick. A `{ writes, nextState }` value cannot express
  this — the executor would become an effect interpreter with failure continuations, moving the logic
  without shrinking it and re-deriving write ordering on code that drives real registers.
- **The pure parts are already pure.** `decideTargetA`, `price-plan`, `peak-shaving-plan`, `slot-window`
  and `planEvPullIn` are plain, separately tested functions; the clock is injected; the harness writes
  through the production `createControlWriter` funnel; no automation test uses `mock.module`.

## Decision

Keep `AutomationIO` flat, called at the point of use; the engine stays the imperative shell around pure
planners. New decision logic is extracted as a planner (the `planEvPullIn` pattern), not an I/O layer.

## Consequences

- Do not re-suggest the snapshot/executor split unless the premise changes: a tick whose effects no
  longer depend on one another's outcomes, or tests that really do hand-build the IO per case.
- A new read costs one member each in `AutomationIO`, the harness and `AutomationModules`. Accepted.
- Write ordering and snapshot-before-write stay readable, in one file, as straight-line code.
