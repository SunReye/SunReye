# 3. Storage and rollups

Status: accepted (2026-11-08), amended (2026-11-08)

## Context

History for years on flash storage, on hardware where memory and write volume matter. In one measured v3 device 69.8 % of stored rows repeated the previous value, and 34 % of every row was configuration. Live values never need the disk.

## Decision

**Store.** One SQLite file under the data directory (`rusqlite`, bundled). WAL, `synchronous=NORMAL`, a checkpoint after each flush, a capped page cache, a fixed page size, and `auto_vacuum=incremental` set at creation. Tables are `WITHOUT ROWID` with no secondary index beyond the key. Each install is one plant and generates a stable install id (a UUID) at first run; local tables carry no plant key. Devices are keyed by a stable integer id from the device registry, never by profile id: a profile can be swapped inside the retention window.

**Change points.** History is a series of change points: a value and the instant it began, plus a gap marker when a silence exceeds the gap threshold. Intervals, their durations and their split at rollup boundaries are derived when rollups and reads need them, so a flat signal costs nothing.

- The deadband compares against the last stored value, never the last reading, so the stored series is never wrong by more than the deadband.
- The gap threshold is three times the poll group's cadence and at least 15 s. A silence beyond it is a gap, not a held value.
- Counters and enums never get a deadband.
- A profile's storage class decides the destination: `series`, `config` (a change-log table, one row per change) or `none`.
- Optional hardware (a generator) is persisted only after any of its readings is non-zero.
- Non-finite readings are never stored. Only measured values become history.
- The pending change points are written on shutdown and on a profile or deadband change.

**Layout.** Two stages. Each flush writes the minute's change points into a hot table keyed by integer device id, series id and time. A series is the interned pair of role and index, such as `pv.string.power[2]`; an unindexed role is a series of its own. Rollups and the API address series the same way. One owned task packs every closed hour, per device and series, into one block row and deletes the hot rows; an hour without a change writes nothing. A block holds the first change point, then zigzag variable-length deltas of time (at 100 ms resolution) and of value. Reads merge hot rows with blocks and carry the last value forward from the previous block. No general-purpose compressor: zstd or lz4 would add a dependency for a small gain on data that is already delta-encoded.

**Values.** Fixed-point integers, never floats. The scale is the point's quantisation step from the profile, so nothing the register can express is lost; a float register declares its resolution (ADR 5). Counters are stored as integer deltas.

**Flush.** At most one bucket of change points is held in memory. One transaction is written when each bucket closes. A crash or power cut loses at most the open 60 s of history, a deliberate trade. Live values and every consumer of the bus read memory.

**Rollups.** Hourly and daily, derived from intervals by one owned task that updates the affected rollups after each flush. Hourly rollups are cut on UTC hours. Daily rollups are cut on plant-local days directly from intervals, never summed from hourly ones, so any zone offset is exact. A rollup stores `Σ value·duration`, `Σ duration`, min and max; counters store first and last; enums store neither. The mean is computed on read. Min and max are within one deadband of the true extreme; the poll interval is the resolution floor. Late rows mark rollups dirty and the task recomputes them. A rollup can be dropped and rebuilt while its change points exist.

**Energy.** A role with a lifetime counter yields energy from the counter's delta. Without one, the time-weighted power is integrated. A counter that drops is a reset or rollover, never a negative delta, and a restart gap never invents energy.

**Time.** UTC instants only. Days, weeks and months are cut in the plant timezone, set once by the admin and separate from any viewer's display timezone. Days of 23 or 25 hours fall out of cutting from UTC instants. The daily key is the plant-local date. A timezone change applies from the change date. The daily key records the zone it was cut in: days still inside change-point retention are rebuilt, older days cannot be and keep their zone. Tests pass an explicit zone and never change the process timezone.

**Clock.** Low-power hosts boot without a synced clock. No change point is written at or before the last stored instant of its series; a backwards step is recorded as a gap and writing continues. Until the wall clock is later than both the build time and the last stored instant, history writing is held, live serving continues, and the API reports `clock.unsynced`.

**Retention.** Hourly and daily rollups are kept forever. Change-point retention is a setting, 5 years by default. Estimated, not measured: a hybrid inverter polled every 5 s with the default deadbands stores roughly 100 to 300 MB per device-year. Expiry deletes whole blocks and returns pages in small incremental-vacuum steps, so the file shrinks.

**Migrations and backup.** Forward-only numbered SQL, embedded and applied at startup in one transaction. The core refuses a database whose schema is newer than it knows. Backup uses SQLite's online backup API into a file the admin names, through the API and the CLI, without secrets unless asked (ADR 7) but always with the core's identity key (ADR 16). Restore replaces the file while the core is stopped.

**Full disk.** History writing stops, live serving continues, the API reports `storage.full`. A prune task deletes expired blocks in small batches.

## Considered options

- **TimescaleDB.** Rejected: a server process, and v3's hyperfunctions and compression jobs cannot run on Android.
- **Floats.** Rejected: integers delta-encode far better and are exact.
- **One row per interval.** Rejected: key, row header and page overhead cost several times the value.
- **Fixed-rate samples.** Rejected: row volume then scales with the poll rate; change-encoding makes it a property of the signal.
- **Daily rollups summed from hourly ones.** Rejected: exact only for whole-hour offsets, and v5 has no parity requirement with an older release.

## Consequences

Every reader derives intervals from change points and time-weights them. A plain average over stored values is wrong.
