---
title: Requirements
description: What you need to run SunReye.
---

## Runtime

- **[bun](https://bun.sh/)** — the JavaScript runtime and package manager the whole
  monorepo uses. Install it first.
- **PostgreSQL with TimescaleDB** — telemetry is stored in a hypertable with
  continuous-aggregate rollups. The project ships a Docker Compose file that runs a
  pinned `timescale/timescaledb:*-pg17` image; you can also point at any existing
  PostgreSQL + TimescaleDB instance via `DATABASE_URL`.
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

Long-horizon history lives in the rollups, each built directly from the raw table:

| Data | Resolution | Retention |
| --- | --- | --- |
| `metrics_raw` | change-only | 5 years |
| `minute_rollups` | 1 min | frozen — decaying, 90 days |
| `hourly_rollups` | 1 hour | 10 years |
| `daily_rollups` | 1 day | forever |

Every interval is tunable in `packages/db/src/timescale/policies.sql`, which is re-applied on every
migration run. Raw was 7 days when a day of raw cost 5–9 GB uncompressed; at the measured footprint
that was discarding second-resolution replay to save single-digit megabytes.

### Why the minute tier is frozen

Change-only storage removed the reason the minute rollups existed. Measured on 30 days of
change-only traffic at the authored deadbands, compressed, one device:

| tier | per device-year |
| --- | --- |
| `metrics_raw` | 361 MB |
| `minute_rollups` + `weighted_minute_rollups` | 333 MB |

The tier that was built because it was ~15x cheaper per day of coverage than raw now costs about
the same as raw — while also being the *ceiling* on raw retention, since raw may not outlive the
shortest aggregate it is materialized into. So the two minute aggregates are no longer refreshed,
and raw answers minute-resolution reads directly, bucketed and time-weighted at read time. Raw's
retention is then bounded by the hourly tier's 10 years instead of the minute tier's 90 days, and
5 years costs about **1.8 GB per device**.

They are frozen rather than dropped: every bucket already materialized keeps answering reads until
its own retention ages it out. On a deployment whose raw does not yet reach back that far, those
buckets are the only minute-resolution record of the days raw no longer covers.

This assumes the installed profile actually carries deadbands. Without them raw runs about 5.5x
heavier and five years does not fit the footprint budget.

### What that costs backups

Raw used to be excluded from the addon's default backup because it was fully materialized into the
rollups — the backup kept the span at coarser resolution, which is exactly what `backup_full: false`
is for. With the minute tier frozen, raw is the only minute-resolution record, so excluding it would
restore an hourly-only history. `dump.sh` derives this from the database rather than assuming it:
if the minute tier is not being refreshed, raw is included whatever the retention numbers say.
Backups are correspondingly larger. `bun run test:storage` fails if a policy edit breaks the
invariant.

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
