# 4. Rollups in the core, one append-only store

Status: accepted (2026-11-01)

## Context

2.x computes rollups inside TimescaleDB: a `metrics_raw` hypertable, three continuous aggregates, toolkit
hyperfunctions (`time_weight`, `counter_agg`, `interpolated_average`) and compression and retention
policy jobs. None of it runs on Android or ESP-IDF. PGlite has no TimescaleDB and does not support mobile;
SQLite on ESP32 exists only as community ports. A storage trait with one backend per target would write
every rollup twice.

On the ESP32-P4, microSD writes reach 10–13 MB/s in large blocks and ~0.6 MB/s in 256-byte writes; ESP-IDF
rates FAT's power-loss resilience its weakest point and LittleFS as resilient. No open-source ESP32
energy project keeps multi-year history.

## Decision

The core computes raw → minute → hourly → daily rollups as readings arrive: time-weighted averages and
counter deltas with restart, midnight and DST handling, bucketed in the plant time zone. Storage only
appends and reads ranges, in one append-only format that suits SD, flash and disk. Every target uses the
same tiers; only retention defaults differ (ESP32: raw 30 d, minute 2 y, hourly and daily forever, set
from measured bytes per day).

On the ESP32, the store sits on LittleFS, writes are buffered in PSRAM and flushed every 60 s; a power
cut loses at most that window. An industrial pSLC card is recommended, not required.

## Consequences

- Rollup logic is pure, unit-tested code, identical on every target; DST days are oracle fixtures.
- Postgres leaves every edition, including the add-on's bundled server and its dump-based backups.
- Backups leave the device automatically, in the archive format every target imports; the card or tablet
  storage is treated as disposable.
- Time zones come from `jiff` with the IANA database compiled in, never the system's, so buckets agree
  across targets.
