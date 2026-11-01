# 4. Rollups in the core, one SQLite store

Status: accepted (2026-11-01); amended the same day: store from a custom append-only format to SQLite,
ESP32 parts removed (ADR 0006)

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
- The core computes raw → minute → hourly → daily rollups as readings arrive: time-weighted averages and
  counter deltas with restart, midnight and DST handling, bucketed in the plant time zone. SQLite stores
  and reads; it computes no rollup.
- Plain SQL through `sqlx`, no ORM. Queries use `query!` / `query_as!`, checked against the schema at
  compile time from the committed `.sqlx` cache; `scripts/ci` runs `cargo sqlx prepare --check`.
  Migrations use `sqlx::migrate!`; sessions use `tower-sessions-sqlx-store`.
- Every target uses the same tiers and retention defaults, set from measured bytes per day.
- Each minute row is committed as it closes; a power cut loses at most the minute in progress.

If `sqlx`'s SQLite driver cannot build for `aarch64-linux-android`, every target moves to `rusqlite` (the
same C library, synchronous API); targets do not split.

## Consequences

- Rollup logic is pure, unit-tested code, identical on every target; DST days are oracle fixtures.
- Every query is proven twice: at compile time against the schema, and by a unit test against an
  in-memory SQLite. Never by asserting SQL text.
- A schema or query change without a regenerated `.sqlx` cache fails `scripts/ci` with the command to run.
  `scripts/ci` needs `cargo-sqlx`: `cargo install sqlx-cli --locked`.
- Postgres leaves every edition, including the add-on's bundled server and its dump-based backups.
- Backups leave the device automatically, in the archive format every target imports; the device's own
  storage is treated as disposable.
- Time zones come from `jiff` with the IANA database compiled in, never the system's, so buckets agree
  across targets.
