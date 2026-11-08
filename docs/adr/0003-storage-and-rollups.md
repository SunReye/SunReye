# 3. Storage and rollups

Status: proposed (2026-11-08)

## Context

History for years on flash storage, on hardware where memory and write volume matter. In one measured v3 device 69.8 % of stored rows repeated the previous value, and 34 % of every row was configuration. Live values never need the disk.

## Decision

**Store.** One SQLite file under the data directory (`rusqlite`, bundled). WAL, `synchronous=NORMAL`, a checkpoint after each flush, a capped page cache, no automatic VACUUM. Devices are keyed by a stable integer id from the device registry, never by profile id: a profile can be swapped inside the retention window.

**Intervals.** Readings are change-encoded. A row is an interval: a value held for a duration, starting at a time, inside one 60 s epoch-aligned bucket.

- The deadband compares against the last stored value, never the last reading, so the stored series is never wrong by more than the deadband.
- No interval crosses a bucket boundary. Each is closed and reopened at the boundary, which is also the heartbeat of a flat signal.
- A silence over 15 s is a gap, not a held value.
- Counters and enums never get a deadband.
- A profile's storage class decides the destination: `series`, `config` (a change-log table, one row per change) or `none`.
- Optional hardware (a generator) is persisted only after any of its readings is non-zero.
- Non-finite readings are never stored. Only measured values become history.
- Open intervals are closed and written on shutdown and on a profile or deadband change.

**Flush.** At most one bucket of intervals is held in memory. One transaction is written when each bucket closes. A crash or power cut loses at most the open 60 s of history, a deliberate trade. Live values and every consumer of the bus read memory.

**Rollups.** Hourly and daily, derived from intervals by one owned task that updates the affected buckets after each flush. A bucket stores `Σ value·duration`, `Σ duration`, min and max; counters store first and last; enums store neither. The mean is computed on read, so a daily bucket is exact from hourly ones. Min and max are within one deadband of the true extreme; the poll interval is the resolution floor. Late rows mark buckets dirty and the task recomputes them. A rollup can be dropped and rebuilt while its intervals exist.

**Energy.** A role with a lifetime counter yields energy from the counter's delta. Without one, the time-weighted power is integrated. A counter that drops is a reset or rollover, never a negative delta, and a restart gap never invents energy.

**Time.** UTC instants only. Days, weeks and months are cut in the plant timezone, set once by the admin and separate from any viewer's display timezone. Days of 23 or 25 hours fall out of cutting from UTC instants. The daily key is the plant-local date. Tests pass an explicit zone and never change the process timezone.

**Retention.** Hourly and daily rollups are kept forever. The interval retention is a setting; its default comes from the measured size per device-year in the skeleton.

**Migrations and backup.** Forward-only numbered SQL, embedded and applied at startup in one transaction. The core refuses a database whose schema is newer than it knows. Backup uses SQLite's online backup API into a file the admin names, through the API and the CLI. Restore replaces the file while the core is stopped.

**Full disk.** History writing stops, live serving continues, the API reports `storage.full`. A prune task deletes expired intervals in small batches.

## Considered options

- **TimescaleDB.** Rejected: a server process, and v3's hyperfunctions and compression jobs cannot run on Android.
- **Fixed-rate samples.** Rejected: row volume then scales with the poll rate; change-encoding makes it a property of the signal.
- **UTC day buckets cut from hourly rollups.** Rejected: exact only for whole-hour offsets, and v5 has no parity requirement with an older release.

## Consequences

A history row is an interval, so every reader must time-weight. Plain `avg(value)` over rows is wrong.
