## `evcc.ndjson`: EVCC read-only ingest

The 3.x ingest (`apps/server/src/evcc/`: `evcc-topics.ts`, `evcc.ts`, `ev-power-estimator.ts`, `evcc-registrar.ts`,
`evcc-devices.ts`), run over fixed inputs. One line per case, `input` beside `output`.

- `topic/*`: `input` `{root,topics}`, `output` per topic `{topic,loadpoint,vehicle}`, from `parseLoadpointTopic` and
  `parseVehicleTopic`. `payload/coercion`: `coercePayload` per raw string.
- `fold/*`: `createEvccIngest` against a recording broker link. `input` `{config,rowTopicRoot,steps}`; a step is
  `connect`, `drop` (broker closed), `message` (`retained` is recorded, the ingest never reads it) or `load` (a
  house-load sample). `output` `{subscribed,published,steps}`, each step's `state` being `snapshot()` (`EvccState`,
  `crates/sunreye/src/evcc.rs`; `null` when the ingest is off).
- `estimator/*`: `createEvPowerEstimator` on an injected clock. A step is `anchor` (`chargePower`), `params` or `load`
  at `at` ms; `output` per step `{changed,live}`, `changed` `null` for `params`, `live` per loadpoint index.
- `readings/*`: `createLoadpointRegistrar` against doubles: `ensureDevice` answers `input.rows[id]` (default `ready`),
  `reloadRegistry` makes the `ready` rows resolve, `forgetDevice` drops one. `output.syncs` is the calls of each
  `sync` in order (`ensure`, `reload`, `commit` with the sample, `forget`, `warn`). `readings/device-spec` is
  `loadpointDeviceSpec` and `LOADPOINT_METRICS`.
- `commands/no-command-topic`: every subscription and publish of a full run.

Facts the core must decide about:

- **A loadpoint never leaves the snapshot.** Empty retained payloads delete its keys, the count topic `<root>/loadpoints`
  is ignored, and the loadpoint stays listed until the ingest stops. Its deleted `chargePower` reads `0` while
  `chargePowerLive` keeps the last anchor (`fold/loadpoint-vanishing`). The registrar's retirement is therefore
  unreachable from the 3.x ingest; `stop` suspends, it does not retire.
- **The index is `Number()` of the segment.** `01` and `1e0` are loadpoint 1; `0`, `-1`, `1.5` are no loadpoint; a
  trailing slash gives the key `""`.
- **`coercePayload` is `Number()`.** `0x10` is 16, `1e3` is 1000; `NaN` and `True` stay strings.
- **A non-number `chargePower` does not anchor.** The snapshot shows `0`, the live figure keeps the last anchor.
- **Reachable is the broker connected and `<root>/status` exactly `online`** after trimming (`fold/status-padded`). A status never seen is
  unreachable.
- **`vehicleTitle` falls back to `vehicleName`**, never to the vehicle's own `title` topic. A capacity of `0` is no
  capacity.
- **Load samples reach the estimator only with `subtractFromHome`.** The flag rides on the state; the readings are
  the same either way. With it, a step after the retained snapshot is attributed from `charging`, `mode`,
  `phasesActive` and `effectiveMaxCurrent` (`fold/subtract-*`: one estimated step per run, the ingest's estimator reads
  the wall clock).
- **Estimator bounds.** A step under 150 W is noise; a step attributes when it snaps to whole amps at 230 V (within
  10 %, at most 0.4 A) on the known phases, else on 1 or 3; at most once per 3000 ms (3000 attributes, 2999 does not);
  only with exactly one charging loadpoint; in `now` mode only downward. The estimate clamps to
  `[0, phases × 230 × maxA × 1.1]` (3 phases, 16 A when unknown); `live` rounds to whole watts. A `null` load clears
  the baseline.
- **The sample carries the live power with its provenance.** The 3.x writer keeps only `measured` values as history.
  Session energy is Wh / 1000; an absent SoC or session energy is absent; `connected` and `charging` are `0`/`1`.
- **A retired or unresolved row is re-ensured after 300 000 ms** (inclusive) and warned about once. An `absent` row (no
  plant) stops the round: nothing is committed.
- **The sync instant is the wall clock in 3.x** (`new Date()` at each debounced emit).

Dropped under ADR 0005, not recorded: the `mode/set` feed-forward (`feedForward`, the `/set` echo branch of
`handleMessage`, its confirmation and 75 s revert), `control` (`mode`, `limitSoc` routed to the vehicle or the
loadpoint, `batteryBoost`, `batteryBoostLimit`) and the boost-after-mode ordering. The `<root>/loadpoints/#`
subscription still receives other controllers' `/set` echoes; the topic grammar drops them.

| group | cases |
| --- | --- |
| topic grammar | `topic/default-root` (1-based index, nested keys, count topic, bare id, `/set` echoes, vehicles, `<root>/status`, other roots, empty topic), `topic/custom-root` |
| payload coercion | `payload/coercion` (empty, whitespace, `null`, booleans, zero, negative, padded, exponent, hex, `NaN`, text, JSON blob) |
| state fold | `fold/retained-snapshot-then-live`, `fold/vehicle-joined-by-name` (capacity, unknown vehicle, zero capacity), `fold/effective-limit-soc`, `fold/evcc-offline`, `fold/status-never-seen`, `fold/broker-dropped`, `fold/loadpoint-vanishing`, `fold/charge-power-boundaries` (zero, negative, non-number, whitespace), `fold/loadpoints-sorted-by-index`, `fold/custom-topic-root` (row root over the setting), `fold/load-sample-without-subtract`, `fold/status-padded`, `fold/subtract-estimates-3-phase`, `fold/subtract-clamps-at-max-current` (`phasesActive` 1, `effectiveMaxCurrent` 6), `fold/subtract-now-mode-upward-absorbed`, `fold/disabled`, `fold/no-connection` |
| estimator | `estimator/never-anchored`, `estimator/anchor-zero-and-negative`, `estimator/residual-then-re-anchor`, `estimator/re-anchor-rebases-house`, `estimator/noise-absorbed`, `estimator/house-step-absorbed`, `estimator/unknown-phases-single-phase-step`, `estimator/above-max-current-absorbed`, `estimator/now-mode-downward-only`, `estimator/rate-limit-2999ms`, `estimator/rate-limit-3000ms`, `estimator/clamp-at-zero` (negative load), `estimator/clamp-at-max`, `estimator/not-charging-absorbed`, `estimator/two-charging-no-owner`, `estimator/absent-load-resets-baseline`, `estimator/zero-load` |
| loadpoint readings | `readings/device-spec`, `readings/register-and-retire`, `readings/steady-roster-no-reload`, `readings/loadpoint-returns`, `readings/sample-boundaries` (absent, zero, negative, estimated), `readings/no-plant`, `readings/retired-row-retry`, `readings/subtract-from-home` |
| no command topic | `commands/no-command-topic` |
