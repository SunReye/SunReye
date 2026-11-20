# 24. Performance at ten years

Status: accepted (2026-11-20), amended (2026-11-20, three times)

## Context

ADR 2 chose the runtime from known costs rather than measured ones. An install runs for years under a 64 MB and half-CPU container limit, and its file grows for ten: change points for five years (ADR 3), rollups and passed forecasts forever (ADR 15). Nothing showed the core stays fast at that size.

## Decision

- **Reference plant.** The benchmark generates one plant: a Deye SG01HP3 with a battery and 5 strings on 2 MPPT inputs, a Deye SG05LP3 with 3 strings on 2 inputs, a Shelly Pro 3EM at the grid connection, an EVCC loadpoint, and a second Shelly Pro 3EM on the heat pump's circuit, stored but outside the topology, which places a grid meter only at the root (ADR 14), with weather, spot prices and PV forecasts, at Berlin's location and timezone. A smaller plant is a subset of it.
- **Data.** Synthetic physics from a fixed seed: sun curves from the clear-sky model with random cloud days, load noise around a daily profile, a battery cycling on the surplus. Each series has its real step and deadband, so storage compresses it as it would live. Random noise would bloat the file; replayed days would lack seasons.
- **Generator.** A dev-only crate, `crates/synth`, never in the image. It registers the plant through the core's own functions, then inserts ten years directly through the history import (ADR 18), one series at a time: the years past change-point retention as hourly and daily values only, as rollups are all that is kept of them, the last five as readings at each role's cadence, which the import stores as change points in the series' own step and deadband. Derived series, such as the plant's aggregates (ADR 14) and string estimates (ADR 17), are inserted as computed from the same physics. Forecasts are inserted as one issue a day of every passed target, and the remaining week as live issues would leave it. It uses no network. Its file is cached under `target/bench/`, keyed by generator version and seed; a file from an earlier schema is opened by the core, which migrates it as an install upgrades, and that migration is timed too; while the cache holds only a file at the current schema, the row says so.
- **Harness.** `bun run bench` (`scripts/bench.ts`) builds or reuses the file, starts the release image on a copy with `--memory 64m --cpus 0.5` and no devices to reach, signs in as the admin the generator set, and measures:
  - every read route the screens call, once cold and 30 times warm: dashboard, History by day, month and year with records and payback, Explore with overlays and folds, the series catalog, the detail sheets;
  - startup from a stopped container to the first answer;
  - one clock tick of expiry on the first day change points pass retention, as long as it holds the storage thread, which every read queues behind; the I/O thread runs no expiry (ADR 2);
  - learned corrections, the clear-sky index and a forecast refresh over the full history;
  - backup and restore of the file;
  - migrating a cached file from an earlier schema;
  - peak memory, from the container's cgroup;
  - file size, and bytes written a day at a steady state.
- **Budgets**, at 0.5 CPU and 64 MB on the ten-year file:

  | Measurement | Budget |
  |---|---|
  | A screen's reads together | ≤ 150 ms warm at p95, ≤ 1 s cold |
  | One read | ≤ 100 ms at p95 |
  | Startup | ≤ 5 s |
  | An expiry tick, holding the storage thread | ≤ 200 ms |
  | Corrections, clear-sky index, forecast refresh | ≤ 30 s each, the I/O thread answering within 50 ms meanwhile |
  | Backup | ≤ 2 min |
  | Peak memory | ≤ 48 MB |
  | Writes at a steady state | ≤ 50 MB a day |

- **Batched reads.** A range read lists up to 16 series of one device (ADR 9), so a screen's reads are fewer requests. The one-read budget holds per series: the harness divides a batch's time by its series and checks that against 100 ms at p95. A batch does not hold the storage thread: the core sends each series' read to it as its own request, one after another, and the thread answers its queue in order, so a write or another screen's read queued meanwhile is answered between two series rather than after the batch.
- **A breach.** The command prints each measurement beside its budget and exits non-zero on any breach. A breach blocks a release until it is fixed, or until this ADR raises the budget with a reason. No history of runs is kept: a run on an earlier commit is the comparison.
- **When.** On demand and before every release, never in the gate (ADR 13).

## Considered options

- **Feeding every poll through the bus and storage thread over ten simulated years.** Rejected: measured at about 56 s per simulated day, 57 hours for ten years. The import path writes the same format with the core's own encoder.
- **A separate encoder writing the tables.** Rejected: it drifts from storage.
- **Committing each run's results.** Rejected: they go stale and add merge noise; any run is reproducible.

## Consequences

A container limit slows the CPU, not the disk: the harness cannot show an SD card's I/O. A run on a Raspberry Pi 4 (arm64, SD card) is the hardware check before a release. Import from v3 (ADR 18) is measured by its own test.
