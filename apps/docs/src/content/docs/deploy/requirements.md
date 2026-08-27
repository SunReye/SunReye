---
title: Requirements
description: What you need to run SunReye.
---

## Runtime

- **[bun](https://bun.sh/)** — the JavaScript runtime and package manager the whole
  monorepo uses. Install it first.
- **PostgreSQL with TimescaleDB + timescaledb_toolkit** — telemetry is stored in a
  hypertable with continuous-aggregate rollups. The project ships a Docker Compose file
  that runs the pinned `ghcr.io/sunreye/timescaledb:pg17-ts2.28.2` image (PostgreSQL 17,
  TimescaleDB and the toolkit); you can also point at any existing PostgreSQL +
  TimescaleDB instance via `DATABASE_URL`, provided the **timescaledb_toolkit**
  extension is available there — the rollups use its `time_weight` and `counter_agg`.
- **Docker** (recommended) — used both for the local database and for the
  [full-stack deployment](/deploy/docker/).

## Hardware (optional)

An inverter is **not** required to run SunReye. The built-in
[simulator](/start/quick-start/) (`INVERTER_SIMULATE=true`, the default) generates coherent
fake telemetry, so you can develop, demo, and evaluate the whole stack with no hardware.

To connect real hardware you need an inverter reachable over **Modbus TCP** (or
**RTU-over-TCP** via a serial gateway) on your network. Support is profile-driven — see
[Supported Inverters](/profiles/supported/).

### Recommended hardware

These are devices the maintainer runs and can vouch for — they work really well in practice.
Nothing here is required; any Modbus-TCP-capable gateway will do.

- **Waveshare Modbus gateway (PoE)** — bridges the inverter's serial Modbus to **Modbus TCP**
  (or **Modbus RTU over TCP**) on Ethernet, so SunReye can poll it over the network. PoE means
  a single cable for power and data. [Search on Amazon](https://amzn.to/452b4DC).
- **DIN-rail-mount gateway** — fits into a DIN rail slot with a little trimming of the window
  plastic. Available in two variants:
  - [Non-PoE](https://amzn.to/4eYeVHP)
  - [PoE](https://amzn.to/4aKZh00)

> The Amazon links above are affiliate links — buying through them supports SunReye at no
> extra cost to you.

## Storage

Telemetry is stored in TimescaleDB as narrow rows — but **one row per metric per *change*, not
per poll**. That distinction is the whole storage story, so it is worth stating plainly:

> The number of times a signal changes per day is a property of the signal, not of the sampler.

So **poll rate and stored volume are decoupled**. Polling at 1 Hz for control quality costs the
same history as a 30-second logger. Device count still scales the stream linearly; poll rate no
longer does. Measured on one real device, 69.8 % of every row previously written was a
byte-identical repeat of the value before it.

A stored row is therefore an *interval*, not a sample: it records the value and how long that
value was held. The rollups compute a **time-weighted** average from that, which is what keeps a
mostly-idle signal with short excursions (grid import, battery power, any CT reading) honest — a
plain average over a change-only series reports something close to the spike.

### What is stored, and what is not

| Class of metric | Stored as |
| --- | --- |
| Measurements (power, voltage, current, temperature) | change-only, plus an optional per-metric deadband |
| Energy counters (`*.total_*`, `*.daily_*`) | change-only, **exact** — never deadbanded, so a counter reset is never swallowed |
| Status enums | change-only, exact |
| Configuration (time-of-use slots, inverter settings) | a **change-log**, not the timeseries table — one row when the value actually changes |
| Hardware that is not connected (e.g. a generator input reading a constant 0) | not stored until it answers |

The profile decides, per metric, through its `storage` and `deadband` fields — so a vendor whose
registers are named differently gets the same treatment, and a profile author can keep the history
of a setting worth charting. A **deadband** is the smallest change worth storing, in the metric's
own unit, compared against the last value that was *stored*: a "1 V deadband" therefore means the
stored series is never wrong by more than 1 V.

### How much is actually stored on disk

Measured on the dev instance (one device, 3 s poll cadence, 108 metrics) before this work:

| | Measured |
| --- | --- |
| Device writes | **3.39 GB/day** |
| Rows | 3.11 M/day |
| Uncompressed row | 226.6 B |
| Compressed row | **4.1 B** — a ratio of **55x** |
| Write amplification | 16.0x |

Three levers act on that, in the order they matter:

1. **Compression at 55x**, with `compress_after` at 2 hours so the uncompressed hot window stays
   small. Before the retune, two full days sat uncompressed — 1011 MB of a 1232 MB database.
2. **Configuration and absent hardware out of the timeseries table.** On the measured profile 37
   of 108 metrics were configuration registers being rewritten every poll: 34 % of every row,
   carrying no information.
3. **Change-only storage with per-metric deadbands**, the largest lever, and rate-independent.

Long-horizon history lives in the rollups. There is **one generation** of them in 2.0.0, and
they form a chain: the minute and hourly tiers are built from `metrics_raw`, and the daily tier is
built from the hourly tier (a hierarchical continuous aggregate). Every tier stores time-weighted
`time_weight` / `counter_agg` **partials** rather than finished numbers, which is what lets a new
accessor or a coarser tier be added later without re-materializing anything:

| Data | Resolution | Retention |
| --- | --- | --- |
| `metrics_raw` | change-only | 5 years (1825 days) |
| `minute_rollups` | 1 min | 90 days |
| `hourly_rollups` | 1 hour | 10 years (3650 days) |
| `daily_rollups` | 1 day | forever |

Every interval is tunable in `packages/db/src/timescale/policies.sql`, which is re-applied on every
migration run. Raw was 7 days when a day of raw cost 5–9 GB uncompressed; at the measured footprint
that was discarding second-resolution replay to save single-digit megabytes.

### Why the minute tier is refreshed again

1.x shipped **two** generations of aggregates — an unweighted `avg(value)` set and a `weighted_*`
set — and then *froze* the minute pair, because on 30 days of change-only traffic at the authored
deadbands, compressed, one device, the two minute aggregates cost 174 + 159 MB per device-year
against raw's 361 MB. A tier that existed because it was ~15x cheaper per day of coverage than raw
cost about the same as raw, while also capping raw's retention (raw may not outlive the shortest
aggregate it is materialized into). Raw answered minute reads instead.

2.0.0 removes two of that argument's three premises:

- There is now **one** minute aggregate, not two, and its row is a 49 B `TimeWeightSummary` plus two
  doubles rather than six doubles — so the comparison is against roughly a quarter of that 333 MB.
- Raw is now kept **1825 days**, so "raw answers minute reads" would mean every short-horizon chart
  scans a five-year hypertable.

So the minute tier is refreshed again, and it is what keeps a six-hour chart off raw. Its 90-day
retention is a **resolution window, not a coverage horizon**: past 90 days a minute-resolution read
goes to raw and a wider read goes to hourly, so nothing is lost when a minute bucket ages out. That
exemption from the coverage rule is declared deliberately, in `RAW_MAY_OUTLIVE_TIERS`
(`scripts/storage-tuning.ts`), and `bun run test:storage` fails if a policy edit breaks it.

Honest status: **~85 MB per device-year is a re-derivation from measured components, not a fresh
measurement of the new shape.** It is to be confirmed on the first month of 2.0.0 traffic. If it
disappoints, freezing the tier again is an edit to `policies.sql`, which is re-applied on every
migration run and so reaches every deployment on the next start.

### What that costs backups

Raw used to be excluded from the addon's default backup because it was fully materialized into the
rollups — the backup kept the span at coarser resolution, which is what `backup_full: false` is for.
That is no longer safe: raw is kept five years and the minute tier only ninety days, so a backup
without raw would restore a history that stops at the hourly tier's resolution after three months.
`dump.sh` derives this from the database rather than assuming it — `safe_to_exclude_raw` compares
the live retention intervals *and* checks whether the minute tier is refreshed at all — so a backup
taken under the shipped policies includes raw, and backups are correspondingly larger.

### Row identity, and why it is two `int2`s

A reading is `(time, value, dur_ms, device_id, metric_id)`. Until 2.0.0 the identity was two `text`
columns — an `inverter_id` that actually held the *profile* id, and a metric key — and both sat on
the write path. Measured on 200,000 rows, one device, 108 metrics:

| identity | heap | `(id, metric, time)` index | total |
| --- | --- | --- | --- |
| `text`, `text` | 16 MB | 11 MB | 32 MB |
| `int2`, `int2` | 9.95 MB | 6.04 MB | 20 MB |

The saving is on the **uncompressed** path — the write-ahead log, the two-hour hot window, and both
indexes — and not on compressed chunks, where `compress_segmentby` already stores the repeated text
once per segment. That is the point: the objective is SSD/eMMC endurance, not footprint. The larger
reason is correctness, though: `inverter_id` held the profile id, so two identical inverters
collided and a profile swap orphaned all history.

### SSD endurance (TBW)

The on-disk footprint is bounded and roughly flat; the *drive* is written to continuously, and that
is what determines lifetime. Every row costs the write-ahead log, the heap, and two indexes, plus
full-page images after each checkpoint and the compression job rewriting a chunk.

**Measure it rather than trusting a projection.** The harness is in the repo:

```bash
bun run test:wear -- --minutes 60 --devices 1 --poll-ms 1000
```

It reads the container's cgroup `io.stat` for device bytes, `pg_stat_wal` for what Postgres believes
it wrote, subtracts the idle baseline (and still reports it), records the host load each sample was
taken under, and answers a fixed set of gates — the headline ones being **≤ 0.4 GB/day** for one
device at 1 Hz and **≤ 4x** write amplification, down from 3.39 GB/day and 16x. It refuses to
compare populations taken under different host load, and refuses to call a regression from fewer
than five samples per side, because a write-rate figure from a contended host is not comparable to
one from an idle host.

Two figures deliberately have no number in this page: GB/day and lifetime on *your* hardware. Both
depend on your drive's internal write amplification, which cannot be derived from a repo checkout.

#### What SunReye already does

These ship on by default, and no functionality is given up — live monitoring is served from memory
over WebSocket, so the database is only the history store:

- **Change-only storage with per-metric deadbands** (above). Rate-independent, so the poll rate is
  a control-quality decision rather than a storage one.
- **Configuration in a change-log** instead of the timeseries table, and no rows at all for
  hardware that has never answered.
- **Batched history writes.** Rows are buffered and flushed in one transaction every
  `HISTORY_FLUSH_INTERVAL_MS` (default 5 s) instead of one INSERT per poll. A crash loses at most
  that window of *history* — never live data, never corruption. Rows the buffer's cap discards
  during a long database outage are counted and exported, not silently dropped.
- **Compression at 2 hours**, measured at 55x on this data.
- **Tuned Postgres** in every bundled database — the Docker Compose TimescaleDB containers *and*
  the Home Assistant addon's embedded PostgreSQL: `synchronous_commit=off` (group-commit, bounded
  <~0.5 s crash-loss window), `wal_compression=zstd`, and wider checkpoint spacing
  (`max_wal_size=2GB`, `checkpoint_timeout=2h`) to cut full-page-write churn.

**On SD cards and eMMC:** the write volume that made an SD card a non-starter is largely gone, but
wear was never the only problem. The dominant SD failure mode is power loss during an FTL metadata
update, which corrupts blocks unrelated to the write in flight, and most cards cannot report their
own health at all. Prefer NVMe or eMMC where the choice exists; where it does not, back up (the
addon does, on a schedule) and put the box behind a UPS.

To reduce writes further, author deadbands on the noisiest registers in your profile — after
change-only storage that is a larger lever than the poll rate.

## Ports

| Port | Service |
| --- | --- |
| `5173` | Web dashboard (dev) |
| `3000` | Core engine / API |
| `5432` | PostgreSQL / TimescaleDB |
| `3001` | Web dashboard (Docker Compose deployment) |

## Two ways to install

- **[Manual setup](/deploy/manual-setup/)** — run the dev servers directly with bun.
  Best for development and profile authoring.
- **[Docker Compose](/deploy/docker/)** — build and run web + server as containers.
  Best for a persistent self-hosted install.
