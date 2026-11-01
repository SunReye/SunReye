# 4. Rollups in the core, one SQLite store

Status: accepted (2026-11-01); store amended the same day from a custom append-only format to SQLite

## Context

3.x computes rollups inside TimescaleDB: a `metrics_raw` hypertable, three continuous aggregates, toolkit
hyperfunctions (`time_weight`, `counter_agg`, `interpolated_average`) and compression and retention
policy jobs. None of it runs on Android or ESP-IDF. PGlite has no TimescaleDB and does not support mobile.
A storage trait with one backend per target would write every rollup twice.

A custom append-only format would also need hand-rolled persistence for settings, users, sessions and API
keys: transactions and indexes reinvented. DuckDB is too large for the binary budget (ADR 0006), has no
ESP-IDF build and only experimental Android support. SQLite is a few hundred KB of C, runs on every target
(community ports on ESP32), and gives transactions, indexes and real queries.

On the ESP32-P4, microSD writes reach 10–13 MB/s in large blocks and ~0.6 MB/s in 256-byte writes; ESP-IDF
rates FAT's power-loss resilience its weakest point and LittleFS as resilient. No open-source ESP32
energy project keeps multi-year history.

## Decision

One SQLite database file per install (`rusqlite`, `bundled`), in WAL mode.

- Settings, connections, devices, users, sessions and API keys are ordinary tables.
- Readings are stored one row per device per minute, holding that minute's samples in a compact encoding
  the core defines; rollups are rows per tier. Never one row per sample.
- The core computes raw → minute → hourly → daily rollups as readings arrive: time-weighted averages and
  counter deltas with restart, midnight and DST handling, bucketed in the plant time zone. SQLite stores
  and reads; it computes no rollup.
- Plain SQL, no ORM and no `sqlx`. One storage thread owns the connection; schema migrations use
  `PRAGMA user_version` (`rusqlite_migration`).
- Every target uses the same tiers; only retention defaults differ (ESP32: raw 30 d, minute 2 y, hourly
  and daily forever, set from measured bytes per day).

On the ESP32, the database sits on LittleFS; readings are buffered in PSRAM and committed in one
transaction every 60 s, so a power cut loses at most that window. An industrial pSLC card is recommended,
not required.

If `rusqlite` cannot build for `riscv32imafc-esp-espidf`, every target moves to `redb`; targets do not
split.

## Consequences

- Rollup logic is pure, unit-tested code, identical on every target; DST days are oracle fixtures.
- Every query is proven by a unit test against an in-memory SQLite, never by asserting SQL text.
- Postgres leaves every edition, including the add-on's bundled server and its dump-based backups.
- Backups leave the device automatically, in the archive format every target imports; the card or tablet
  storage is treated as disposable.
- Time zones come from `jiff` with the IANA database compiled in, never the system's, so buckets agree
  across targets.
