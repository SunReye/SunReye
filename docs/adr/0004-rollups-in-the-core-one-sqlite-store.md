# 4. Rollups in the core, one SQLite store

Status: accepted (2026-11-01); amended the same day: store from a custom append-only format to SQLite,
ESP32 parts removed (ADR 0006); amended 2026-11-02: rollup buckets are UTC and counters
keep high and low, reopening "bucketed in the plant time zone" and "counter deltas" (2.x evidence below);
amended 2026-11-02: "retention defaults, set from measured bytes per day" gets its measurements and a raw
retention (Retention below)

## Context

3.x computes rollups inside TimescaleDB: a `metrics_raw` hypertable, three continuous aggregates, toolkit
hyperfunctions (`time_weight`, `counter_agg`, `interpolated_average`) and compression and retention
policy jobs. None of it runs on Android. PGlite has no TimescaleDB and does not support mobile.
A storage trait with one backend per target would write every rollup twice.

A custom append-only format would also need hand-rolled persistence for settings, users, sessions and API
keys: transactions and indexes reinvented. DuckDB is too large for the binary budget (ADR 0006) and has
only experimental Android support. SQLite is a few hundred KB of C, runs on every target, and gives
transactions, indexes and real queries.

## Decision

One SQLite database file per install (`sqlx` with its SQLite driver), in WAL mode.

- Settings, connections, devices, users, sessions and API keys are ordinary tables.
- Readings are stored one row per device per minute, holding that minute's samples in a compact encoding
  the core defines; rollups are rows per tier. Never one row per sample.
- The core computes raw → minute → hourly → daily rollups as readings arrive: each bucket keeps its
  time-weighted average, max and min, counters included. SQLite stores and reads; it computes no rollup.
- Rollup buckets are UTC: a day bucket sits at `00:00Z` on both DST days, as 2.x's `daily_rollups`, which
  carry no zone (`fixtures/oracle/README.md` §3).
- The plant time zone enters only when statistics cut days, months and years from hourly rollups. Counter
  deltas, with restart and midnight handling, are computed there, when statistics are read (#316).
- Plant days cut from UTC hours are exact only for whole-hour offsets; 2.x has the same limit.
- Plain SQL through `sqlx`, no ORM. Queries use `query!` / `query_as!`, checked against the schema at
  compile time from the committed `.sqlx` cache; `scripts/ci` runs `cargo sqlx prepare --check`.
  Migrations use `sqlx::migrate!`; sessions use `tower-sessions-sqlx-store`.
- Every target uses the same tiers and retention defaults, set from measured bytes per day.
- Each minute row is committed as it closes; a power cut loses at most the minute in progress.

If `sqlx`'s SQLite driver cannot build for `aarch64-linux-android`, every target moves to `rusqlite` (the
same C library, synchronous API); targets do not split.

## Retention

Measured 2026-11-02 on x86-64, release build, 4 KiB pages: one device, 50 metrics polled every 5 s, three
days appended. Rows per device per day: 1,440 raw, 72,000 minute, 1,200 hourly, 50 daily.

| Tier | Bytes per day, every value changing | Half the values steady | Default | Kept, every value changing |
| --- | --- | --- | --- | --- |
| Raw | 12.6 MB | 6.7 MB | 7 days | 88 MB |
| Minute | 7.2 MB (100 B a row) | 6.1 MB (85 B a row) | 90 days | 650 MB |
| Hourly | 120 KB | 102 KB | 3650 days | 440 MB |
| Daily | 5 KB | 4 KB | forever | 1.8 MB a year |

- Raw keeps 7 days, not 2.0.0's 1825 (23 GB a device): the store sits on an SD card or phone storage. Raw
  adds only sub-minute detail over the minute tier, and the open hour and day it feeds close within a day.
  A device offline longer than raw retention loses its last open hour's bucket; its minutes stay.
- Minute, hourly and daily keep 3.x's 90 days, 10 years and forever: about 1.2 GB a device after 10 years.
- Settings `retention.raw_days`, `retention.minute_days`, `retention.hour_days` and `retention.day_days`
  override the defaults. The pass runs at start and hourly, deleting at most 1,000 rows a statement, so a
  poll waits behind one batch, not the whole pass: dropping 6.5 M rows on x86-64 under load, a poll waited
  21 ms at p99 and 106 ms at worst.

## Consequences

- Rollup logic is pure, unit-tested code, identical on every target; DST days are oracle fixtures.
- Every query is proven twice: at compile time against the schema, and by a unit test against an
  in-memory SQLite. Never by asserting SQL text.
- A schema or query change without a regenerated `.sqlx` cache fails `scripts/ci` with the command to run.
  `scripts/ci` needs `cargo-sqlx`: `cargo install sqlx-cli --locked`.
- Postgres leaves every edition, including the add-on's bundled server and its dump-based backups.
- Backups leave the device automatically, in the archive format every target imports; the device's own
  storage is treated as disposable.
- Time zones come from `jiff` with the IANA database compiled in, never the system's, so statistics days
  agree across targets.
